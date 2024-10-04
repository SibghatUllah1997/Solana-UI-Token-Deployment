const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const {
  Connection,
  Transaction,
  PublicKey,
  clusterApiUrl,
  SystemProgram,
} = require("@solana/web3.js");
const { createInitializeInstruction } = require("@solana/spl-token-metadata");
const {
  TOKEN_2022_PROGRAM_ID,
  getNewAccountLenForExtensionLen,
  ExtensionType,
} = require("@solana/spl-token");
const { pack } = require("@solana/spl-token-metadata");
const fs = require("fs").promises; // Use promises for async file handling
const path = require("path");

// Connection setup
const network = clusterApiUrl("devnet");
const connection = new Connection(network, "confirmed");

const app = express();
app.use(cors());
app.use(express.json()); // To parse JSON body

// Helper function to get additional rent for new metadata
async function getAdditionalRentForNewMetadata(
  connection,
  address,
  tokenMetadata,
  programId = TOKEN_2022_PROGRAM_ID
) {
  const info = await connection.getAccountInfo(address);
  const extensionLen = pack(tokenMetadata).length;
  const newAccountLen = getNewAccountLenForExtensionLen(
    info,
    address,
    ExtensionType.TokenMetadata,
    extensionLen,
    programId
  );

  if (newAccountLen <= info.data.length) {
    return 0;
  }

  const newRentExemptMinimum =
    await connection.getMinimumBalanceForRentExemption(newAccountLen);
  return newRentExemptMinimum - info.lamports;
}

// Function to write mint address to deployedTokens.json
async function writeMintAddressToFile(mintAddress, symbol) {
  const filePath = path.join(__dirname, "UI", "src", "deployedTokens.json");

  // Read existing data
  let data = { mintedTokenDetails: [] }; // Initialize to avoid errors
  try {
    const jsonData = await fs.readFile(filePath, "utf8");
    data = JSON.parse(jsonData);
  } catch (error) {
    console.error("Error reading JSON file:", error);
  }

  const newToken = {
    address: mintAddress,
    symbol: symbol,
  };
  data.mintedTokenDetails.push(newToken);

  // Write the updated data back to the file
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log("mintedTokenDetails saved:", mintAddress, symbol);
  } catch (error) {
    console.error("Error writing to JSON file:", error);
  }
}

// API endpoint to fetch deployed token mint addresses
app.get("/deployed-tokens", async (req, res) => {
  const filePath = path.join(__dirname, "UI", "src", "deployedTokens.json");

  try {
    const data = await fs.readFile(filePath, "utf-8");
    const jsonData = JSON.parse(data);
    res.json(jsonData);
  } catch (err) {
    console.error("Error reading deployedTokens.json:", err);
    return res.status(500).json({ error: "Error reading token data" });
  }
});

// API endpoint for creating metadata
app.post("/create-metadata", async (req, res) => {
  const {
    mintPublicKey,
    payerPublicKey,
    mintAuthority,
    name,
    symbol,
    uri,
    multiSigners = [],
  } = req.body;

  // Validate that mintAuthority and other required fields are provided
  if (!mintAuthority || !name || !symbol || !uri) {
    return res
      .status(400)
      .json({ error: "mintAuthority, name, symbol, and uri are required." });
  }

  try {
    const mint = new PublicKey(mintPublicKey);
    const payer = new PublicKey(payerPublicKey);
    const programId = TOKEN_2022_PROGRAM_ID;
    const updateAuthority = payer;

    const lamports = await getAdditionalRentForNewMetadata(
      connection,
      mint,
      {
        updateAuthority,
        mint,
        name,
        symbol,
        uri,
        additionalMetadata: [],
      },
      programId
    );

    const transaction = new Transaction();

    if (lamports > 0) {
      transaction.add(
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: mint, lamports })
      );
    }

    transaction.add(
      createInitializeInstruction({
        programId,
        metadata: mint,
        updateAuthority,
        mint,
        mintAuthority: updateAuthority,
        name,
        symbol,
        uri,
      })
    );

    // Get the latest blockhash and add it to the transaction
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer;

    // Serialize the transaction for Phantom to sign
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
    });

    // Write the mint address to the JSON file after successful creation
    await writeMintAddressToFile(mint.toString(), symbol);

    res.json({
      transaction: serializedTransaction.toString("base64"),
    });
  } catch (error) {
    console.error("Error creating metadata:", error);
    res.status(500).json({
      error: "Error creating metadata. Please check the server console.",
    });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
