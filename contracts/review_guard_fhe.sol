pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ReviewGuardFHE is ZamaEthereumConfig {
    struct Review {
        euint32 encryptedScore;
        uint256 weight;
        uint256 departmentId;
        address reviewer;
        uint256 timestamp;
        uint32 decryptedScore;
        bool isVerified;
    }

    struct Employee {
        string employeeId;
        string name;
        uint256 totalScore;
        uint256 reviewCount;
        uint256 departmentId;
        mapping(string => Review) reviews;
    }

    mapping(string => Employee) public employees;
    mapping(uint256 => string[]) public departmentEmployees;
    mapping(string => bool) public employeeExists;

    event ReviewSubmitted(string indexed employeeId, address indexed reviewer);
    event ReviewDecrypted(string indexed employeeId, uint32 decryptedScore);
    event FinalScoreCalculated(string indexed employeeId, uint256 finalScore);

    constructor() ZamaEthereumConfig() {}

    function submitReview(
        string calldata employeeId,
        externalEuint32 encryptedScore,
        bytes calldata inputProof,
        uint256 weight,
        uint256 departmentId
    ) external {
        require(employeeExists[employeeId], "Employee does not exist");
        require(weight > 0, "Weight must be positive");

        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, inputProof)), "Invalid encrypted input");

        Employee storage employee = employees[employeeId];
        require(employee.departmentId == departmentId, "Department mismatch");

        string memory reviewId = string(abi.encodePacked(employeeId, "_", uint256(block.timestamp)));
        Review storage newReview = employee.reviews[reviewId];

        newReview.encryptedScore = FHE.fromExternal(encryptedScore, inputProof);
        newReview.weight = weight;
        newReview.departmentId = departmentId;
        newReview.reviewer = msg.sender;
        newReview.timestamp = block.timestamp;
        newReview.decryptedScore = 0;
        newReview.isVerified = false;

        FHE.allowThis(newReview.encryptedScore);
        FHE.makePubliclyDecryptable(newReview.encryptedScore);

        emit ReviewSubmitted(employeeId, msg.sender);
    }

    function verifyReview(
        string calldata employeeId,
        string calldata reviewId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(employeeExists[employeeId], "Employee does not exist");
        
        Employee storage employee = employees[employeeId];
        Review storage review = employee.reviews[reviewId];
        require(!review.isVerified, "Review already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(review.encryptedScore);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        review.decryptedScore = decodedValue;
        review.isVerified = true;

        employee.totalScore += decodedValue * review.weight;
        employee.reviewCount++;

        emit ReviewDecrypted(employeeId, decodedValue);
    }

    function calculateFinalScore(string calldata employeeId) external {
        require(employeeExists[employeeId], "Employee does not exist");

        Employee storage employee = employees[employeeId];
        require(employee.reviewCount > 0, "No reviews available");

        uint256 finalScore = employee.totalScore / employee.reviewCount;
        employee.totalScore = finalScore;

        emit FinalScoreCalculated(employeeId, finalScore);
    }

    function addEmployee(
        string calldata employeeId,
        string calldata name,
        uint256 departmentId
    ) external {
        require(!employeeExists[employeeId], "Employee already exists");

        Employee storage newEmployee = employees[employeeId];
        newEmployee.employeeId = employeeId;
        newEmployee.name = name;
        newEmployee.departmentId = departmentId;
        newEmployee.totalScore = 0;
        newEmployee.reviewCount = 0;

        employeeExists[employeeId] = true;
        departmentEmployees[departmentId].push(employeeId);
    }

    function getEmployee(string calldata employeeId) external view returns (
        string memory name,
        uint256 totalScore,
        uint256 reviewCount,
        uint256 departmentId
    ) {
        require(employeeExists[employeeId], "Employee does not exist");
        Employee storage employee = employees[employeeId];

        return (
            employee.name,
            employee.totalScore,
            employee.reviewCount,
            employee.departmentId
        );
    }

    function getReview(string calldata employeeId, string calldata reviewId) external view returns (
        uint256 weight,
        uint256 departmentId,
        address reviewer,
        uint256 timestamp,
        uint32 decryptedScore,
        bool isVerified
    ) {
        require(employeeExists[employeeId], "Employee does not exist");
        Employee storage employee = employees[employeeId];
        Review storage review = employee.reviews[reviewId];

        return (
            review.weight,
            review.departmentId,
            review.reviewer,
            review.timestamp,
            review.decryptedScore,
            review.isVerified
        );
    }

    function getDepartmentEmployees(uint256 departmentId) external view returns (string[] memory) {
        return departmentEmployees[departmentId];
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

