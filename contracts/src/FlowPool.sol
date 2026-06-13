// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title FlowPool
 * @notice A socially-undercollateralized USDC lending pool for Flows.
 *
 * - LPs deposit USDC and receive shares; loan interest (minus a protocol fee)
 *   grows share value, defaults shrink it.
 * - A receiver borrows the full principal from the pool, while their *sender*
 *   posts partial collateral (50–75%, set off-chain from FlowScore + LineScore).
 * - The off-chain backend never custodies funds: it only EIP-712-signs the loan
 *   terms. The sender submits `fundLoan` from their own wallet (posting
 *   collateral); the contract verifies the signer and disburses to the receiver.
 */
contract FlowPool {
    IERC20 public immutable usdc;
    address public immutable termsSigner; // backend authorizer of loan terms
    address public treasury; // receives the protocol fee on interest
    uint16 public feeBps; // fee on interest, e.g. 1000 = 10%
    address public owner;

    // ---- LP accounting ----
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    // Liquidity owned by LPs and idle in the contract (excludes posted collateral).
    uint256 public liquidity;
    // Principal currently lent out (still an LP-owned receivable).
    uint256 public outstandingPrincipal;
    // Total collateral held across active loans (NOT an LP asset).
    uint256 public collateralHeld;
    // Lifetime protocol fees sent to treasury.
    uint256 public feesCollected;

    enum Status { Active, Repaid, Defaulted }

    struct Loan {
        address receiver;
        address sender;
        uint256 principal;
        uint256 collateral;
        uint256 interest; // absolute USDC interest due
        uint64 dueDate;
        Status status;
    }

    Loan[] public loans;
    mapping(bytes32 => bool) public usedNonce;

    // ---- EIP-712 ----
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant LOAN_TYPEHASH = keccak256(
        "Loan(address receiver,address sender,uint256 principal,uint256 collateral,uint256 interest,uint64 dueDate,bytes32 nonce,uint64 expiry)"
    );

    event Deposit(address indexed lp, uint256 amount, uint256 shares);
    event Withdraw(address indexed lp, uint256 amount, uint256 shares);
    event LoanFunded(uint256 indexed id, address indexed receiver, address indexed sender, uint256 principal, uint256 collateral);
    event LoanRepaid(uint256 indexed id, uint256 interest, uint256 fee);
    event LoanDefaulted(uint256 indexed id, uint256 lossToPool);

    bool private locked;
    modifier nonReentrant() {
        require(!locked, "reentrant");
        locked = true;
        _;
        locked = false;
    }

    constructor(address _usdc, address _termsSigner, address _treasury, uint16 _feeBps) {
        require(_feeBps <= 5000, "fee too high");
        usdc = IERC20(_usdc);
        termsSigner = _termsSigner;
        treasury = _treasury;
        feeBps = _feeBps;
        owner = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("FlowPool"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ---- LP ----
    /// Total LP-owned assets = idle liquidity + outstanding principal (receivable).
    function totalAssets() public view returns (uint256) {
        return liquidity + outstandingPrincipal;
    }

    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        require(amount > 0, "zero");
        uint256 assets = totalAssets();
        shares = (totalShares == 0 || assets == 0) ? amount : (amount * totalShares) / assets;
        require(usdc.transferFrom(msg.sender, address(this), amount), "transfer failed");
        totalShares += shares;
        sharesOf[msg.sender] += shares;
        liquidity += amount;
        emit Deposit(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        require(shares > 0 && shares <= sharesOf[msg.sender], "bad shares");
        amount = (shares * totalAssets()) / totalShares;
        require(amount <= liquidity, "insufficient liquidity");
        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        liquidity -= amount;
        require(usdc.transfer(msg.sender, amount), "transfer failed");
        emit Withdraw(msg.sender, amount, shares);
    }

    // ---- Borrow ----
    struct LoanParams {
        address receiver;
        address sender;
        uint256 principal;
        uint256 collateral;
        uint256 interest;
        uint64 dueDate;
        bytes32 nonce;
        uint64 expiry;
    }

    /// Sender (msg.sender) posts collateral and funds a loan authorized by termsSigner.
    function fundLoan(LoanParams calldata p, bytes calldata sig) external nonReentrant returns (uint256 id) {
        require(msg.sender == p.sender, "only sender");
        require(block.timestamp <= p.expiry, "expired");
        require(!usedNonce[p.nonce], "nonce used");
        require(p.principal > 0 && p.collateral <= p.principal, "bad amounts");
        require(p.principal <= liquidity, "insufficient liquidity");

        bytes32 structHash = keccak256(
            abi.encode(LOAN_TYPEHASH, p.receiver, p.sender, p.principal, p.collateral, p.interest, p.dueDate, p.nonce, p.expiry)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        require(_recover(digest, sig) == termsSigner, "bad signature");

        usedNonce[p.nonce] = true;
        // Pull collateral from the sender, disburse principal from the pool.
        require(usdc.transferFrom(msg.sender, address(this), p.collateral), "collateral failed");
        liquidity -= p.principal;
        outstandingPrincipal += p.principal;
        collateralHeld += p.collateral;
        require(usdc.transfer(p.receiver, p.principal), "disburse failed");

        id = loans.length;
        loans.push(Loan(p.receiver, p.sender, p.principal, p.collateral, p.interest, p.dueDate, Status.Active));
        emit LoanFunded(id, p.receiver, p.sender, p.principal, p.collateral);
    }

    /// Anyone may repay an active loan (typically the receiver). Pays principal + interest.
    function repay(uint256 id) external nonReentrant {
        Loan storage l = loans[id];
        require(l.status == Status.Active, "not active");
        uint256 total = l.principal + l.interest;
        require(usdc.transferFrom(msg.sender, address(this), total), "repay failed");

        uint256 fee = (l.interest * feeBps) / 10000;
        uint256 lpInterest = l.interest - fee;

        outstandingPrincipal -= l.principal;
        liquidity += l.principal + lpInterest; // principal back + LP's share of interest
        collateralHeld -= l.collateral;
        l.status = Status.Repaid;

        if (fee > 0) {
            feesCollected += fee;
            require(usdc.transfer(treasury, fee), "fee failed");
        }
        require(usdc.transfer(l.sender, l.collateral), "collateral return failed");
        emit LoanRepaid(id, l.interest, fee);
    }

    /// Permissionless after dueDate: seize collateral to the pool, write off the rest.
    function liquidate(uint256 id) external nonReentrant {
        Loan storage l = loans[id];
        require(l.status == Status.Active, "not active");
        require(block.timestamp > l.dueDate, "not due");

        outstandingPrincipal -= l.principal;
        collateralHeld -= l.collateral;
        // Collateral becomes pool liquidity; the uncovered principal is an LP loss.
        liquidity += l.collateral;
        uint256 loss = l.principal > l.collateral ? l.principal - l.collateral : 0;
        l.status = Status.Defaulted;
        emit LoanDefaulted(id, loss);
    }

    // ---- views / admin ----
    function loanCount() external view returns (uint256) {
        return loans.length;
    }

    function sharePrice() external view returns (uint256) {
        return totalShares == 0 ? 1e6 : (totalAssets() * 1e6) / totalShares;
    }

    function setTreasury(address t) external {
        require(msg.sender == owner, "only owner");
        treasury = t;
    }

    function setFeeBps(uint16 f) external {
        require(msg.sender == owner, "only owner");
        require(f <= 5000, "fee too high");
        feeBps = f;
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        require(sig.length == 65, "bad sig len");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        return ecrecover(digest, v, r, s);
    }
}
