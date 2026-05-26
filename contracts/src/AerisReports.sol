// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155URIStorage} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AerisReports - tamper-evident receipts for verified AERIS disaster reports.
/// @notice ERC-1155 with per-token URIs. Deployed on SKALE-Base for gasless user-side
///         transactions. Each verified disaster report is minted exactly once using a
///         deterministic tokenId derived from the report UUID.
contract AerisReports is ERC1155URIStorage, Ownable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Hypercerts-shaped metadata schema marker (informational only on-chain).
    string public constant METADATA_SCHEMA = "aeris.report.v1";

    /// @dev Tracks which tokenIds have been minted so retries are idempotent.
    mapping(uint256 => bool) public minted;

    event ReportMinted(
        uint256 indexed tokenId,
        address indexed to,
        string uri,
        string reportId
    );

    constructor(address admin) ERC1155("") Ownable(admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Mint a single ERC-1155 token representing a verified AERIS report.
    /// @param to       Recipient (typically the AERIS service wallet).
    /// @param tokenId  Deterministic uint256 derived from the report UUID.
    /// @param tokenURI ipfs:// or https:// URI returning the Hypercert metadata JSON.
    /// @param reportId Human-readable report UUID for the ReportMinted event log.
    function mintReport(
        address to,
        uint256 tokenId,
        string calldata tokenURI,
        string calldata reportId
    ) external onlyRole(MINTER_ROLE) {
        require(!minted[tokenId], "AerisReports: already minted");
        require(bytes(tokenURI).length > 0, "AerisReports: empty uri");

        minted[tokenId] = true;
        _mint(to, tokenId, 1, "");
        _setURI(tokenId, tokenURI);
        emit ReportMinted(tokenId, to, tokenURI, reportId);
    }

    /// @notice Owner-only escape hatch to update a token URI (e.g. if IPFS pin rotates).
    function updateTokenURI(uint256 tokenId, string calldata newURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(minted[tokenId], "AerisReports: unknown token");
        _setURI(tokenId, newURI);
    }

    function grantMinter(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, account);
    }

    function revokeMinter(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, account);
    }
}
