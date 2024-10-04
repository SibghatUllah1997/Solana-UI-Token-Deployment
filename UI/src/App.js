import React, { useState, useEffect } from "react";
import "./App.css";

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  clusterApiUrl,
  Keypair,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createBurnInstruction,
  ExtensionType,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeTransferHookInstruction,
  createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  withdrawWithheldTokensFromAccounts,
  TOKEN_2022_PROGRAM_ID,
  getTransferFeeAmount,
  getMintLen,
  unpackAccount,
} from "@solana/spl-token";
import { Buffer } from "buffer";

window.Buffer = Buffer;

const App = () => {
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [deployedTokens, setDeployedTokens] = useState([]);
  const [tokenBalances, setTokenBalances] = useState({});
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [withheldFee, setWithheldFee] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tokenURI] = useState(
    "https://gateway.pinata.cloud/ipfs/QmP7rNUJT9w7BuEvCBbip7dqdXrXiS7An2YJ95KLbdYLwS/"
  ); // Predefined URI
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState(0);
  const [burnAmount, setBurnAmount] = useState(0);
  const [mintToPublicKey, setMintToPublicKey] = useState("");
  const [mintAmount, setMintAmount] = useState(0);

  const network = clusterApiUrl("devnet");
  const connection = new Connection(network, "confirmed");

  // Connect Phantom Wallet
  const connectPhantom = async () => {
    if (window.solana && window.solana.isPhantom) {
      try {
        const { publicKey } = await window.solana.connect();
        setWalletAddress(publicKey.toString());
        setWalletConnected(true);
      } catch (err) {
        console.error("Connection error:", err);
        setMessage("Connection to Phantom wallet failed.");
      }
    } else {
      setMessage("Phantom wallet not found. Please install it.");
    }
  };

  // Fetch deployed tokens when wallet is connected
  useEffect(() => {
    const fetchDeployedTokens = async () => {
      if (!walletAddress) return; // Ensure wallet is connected
      try {
        const response = await fetch("http://localhost:3000/deployed-tokens");
        const data = await response.json();
        setDeployedTokens(data.mintedTokenDetails || []); // Ensure it's an empty array if no tokens exist
      } catch (error) {
        console.error("Error fetching deployed tokens:", error);
      }
    };

    fetchDeployedTokens();
  }, [walletAddress]);
  useEffect(() => {
    if (deployedTokens.length > 0) {
      withheldAmount();
    }
  }, [deployedTokens]);
  // Fetch token balances for the connected wallet
  const fetchTokenBalances = async () => {
    if (!walletAddress || deployedTokens.length === 0) return;

    const balances = {};

    for (const token of deployedTokens) {
      const tokenAddress = new PublicKey(token.address);
      try {
        // Fetch all token accounts owned by the wallet for the specific mint
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          new PublicKey(walletAddress),
          {
            mint: tokenAddress, // Filter for specific mint
          }
        );

        if (tokenAccounts.value.length > 0) {
          // There might be multiple accounts, but we'll use the first one for simplicity
          const tokenAccountInfo =
            tokenAccounts.value[0].account.data.parsed.info;

          // Extract the balance in a readable format (uiAmount)
          const balance = tokenAccountInfo.tokenAmount.uiAmount || 0;

          // Store the balance in the object with the token symbol as the key
          balances[token.symbol] = balance;
        } else {
          // No token account found for this mint, meaning balance is 0
          balances[token.symbol] = 0;
        }
      } catch (error) {
        console.error(`Error fetching balance for ${token.symbol}:`, error);
        balances[token.symbol] = 0; // Default to 0 if there's an error
      }
    }

    // Update state with the fetched balances
    setTokenBalances(balances);
  };

  // Fetch balances whenever the deployed tokens change
  useEffect(() => {
    fetchTokenBalances();
  }, [deployedTokens]);

  // Create Token
  const createToken = async () => {
    if (!walletConnected) {
      setMessage("Wallet not connected. Please connect your Phantom wallet.");
      return;
    }

    if (!tokenName || !tokenSymbol || !tokenURI) {
      // Check for token URI
      setMessage("Please enter token name, symbol, and URI.");
      return;
    }

    const extensions = [
      ExtensionType.TransferFeeConfig,
      ExtensionType.MetadataPointer,
      ExtensionType.TransferHook,
    ];

    const mintLen = getMintLen(extensions);
    const payer = window.solana.publicKey;
    console.log("payer", payer);

    if (!payer) {
      setMessage("Unable to access Phantom wallet public key.");
      return;
    }

    const mintKeypair = Keypair.generate();
    const decimals = 9;
    const feeBasisPoints = 100; // 1%
    const maxFee = BigInt(2 * 10 ** 19);

    try {
      const mintLamports = await connection.getMinimumBalanceForRentExemption(
        mintLen
      );
      const mintTransaction = new Transaction();

      // Create the mint account
      mintTransaction.add(
        SystemProgram.createAccount({
          fromPubkey: payer,
          newAccountPubkey: mintKeypair.publicKey,
          space: mintLen,
          lamports: mintLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        })
      );

      // Initialize metadata pointer
      const initMetaInstruction = createInitializeMetadataPointerInstruction(
        mintKeypair.publicKey,
        payer,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      mintTransaction.add(initMetaInstruction);

      //   Initialize transfer hook
      const transferHookInstruction = createInitializeTransferHookInstruction(
        mintKeypair.publicKey,
        payer,
        new PublicKey("BTWGeGKBNQC1zGHbPjYbu2nsZSweHzsoHECPhecgUtQ6"),
        TOKEN_2022_PROGRAM_ID
      );
      mintTransaction.add(transferHookInstruction);

      // Initialize transfer fee config
      const initTransferFeeConfig =
        createInitializeTransferFeeConfigInstruction(
          mintKeypair.publicKey,
          payer,
          payer,
          feeBasisPoints,
          maxFee,
          TOKEN_2022_PROGRAM_ID
        );
      mintTransaction.add(initTransferFeeConfig);

      // Initialize mint instruction
      const initMintInstructions = createInitializeMintInstruction(
        mintKeypair.publicKey,
        decimals,
        payer,
        null,
        TOKEN_2022_PROGRAM_ID
      );
      mintTransaction.add(initMintInstructions);

      // Get the latest blockhash and prepare the transaction for signing
      const { blockhash } = await connection.getLatestBlockhash();
      mintTransaction.recentBlockhash = blockhash;
      mintTransaction.feePayer = payer;
      mintTransaction.partialSign(mintKeypair);

      // Sign the transaction with Phantom wallet
      const signedTransaction = await window.solana.signTransaction(
        mintTransaction
      );
      const serializedTransaction = signedTransaction.serialize();
      const signature = await connection.sendRawTransaction(
        serializedTransaction
      );
      await connection.confirmTransaction(signature, "processed");

      const response = await fetch("http://localhost:3000/create-metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mintPublicKey: mintKeypair.publicKey.toString(),
          payerPublicKey: payer.toString(),
          mintAuthority: payer.toString(),
          name: tokenName,
          symbol: tokenSymbol,
          uri: tokenURI, // Add the token URI here
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Decode the serialized transaction
        const transactionBuffer = Buffer.from(data.transaction, "base64");
        const transaction = Transaction.from(transactionBuffer);

        // Sign the transaction with Phantom wallet
        const signedMetadataTransaction = await window.solana.signTransaction(
          transaction
        );

        // Serialize and send the transaction
        const serializedMetadataTransaction =
          signedMetadataTransaction.serialize();

        const metadataSignature = await connection.sendRawTransaction(
          serializedMetadataTransaction
        );
        await connection.confirmTransaction(metadataSignature, "processed");

        alert(
          `Token created successfully!\nToken name:${tokenName}\nToken Address: ${mintKeypair.publicKey.toString()}`
        );

        // Use setTimeout to ensure that the new tab opens after the alert is dismissed
        setTimeout(() => {
          window.open(
            `https://explorer.solana.com/account/${mintKeypair.publicKey.toString()}?cluster=devnet`,
            "_blank"
          );
        }, 100); // 100 milliseconds delay

        console.log("Transaction signature:", metadataSignature);
      } else {
        setMessage(`Error creating metadata: ${data.error}`);
        console.error("Error creating metadata:", data.error);
      }
    } catch (error) {
      console.error("Error creating token:", error);
      setMessage("Error creating token. Please check console for details.");
    }
  };

  // Fetch User Balance
  const fetchUserBalance = async () => {
    if (walletAddress) {
      const balance = await connection.getBalance(new PublicKey(walletAddress));
      setBalance(balance / 1e9); // Convert to SOL
    }
  };
  const collectTransferFee = async () => {
    setLoading(true); // Start loading state
    setMessage(""); // Clear previous messages

    const accountPublicKey = new PublicKey(window.solana.publicKey);
    const deployedTokens = []; // Your deployed tokens array should be populated

    for (const token of deployedTokens) {
      const mint = new PublicKey(token.address);

      try {
        // Check for associated token account
        const associatedTokenAccount = getAssociatedTokenAddressSync(
          mint,
          accountPublicKey,
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const destinationAccountExists = await connection.getAccountInfo(
          associatedTokenAccount
        );

        // Create associated token account if it does not exist
        if (!destinationAccountExists) {
          const transaction = new Transaction().add(
            createAssociatedTokenAccountIdempotentInstruction(
              accountPublicKey,
              associatedTokenAccount,
              accountPublicKey,
              mint,
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );

          // Send the transaction to create the associated token account
          const signature = await window.solana.sendTransaction(
            transaction,
            payerWallet.payer
          );
          await connection.confirmTransaction(signature);
        }

        // Fetch all accounts associated with the token mint
        const allAccounts = await connection.getProgramAccounts(
          TOKEN_2022_PROGRAM_ID,
          {
            commitment: "confirmed",
            filters: [
              {
                memcmp: {
                  offset: 0,
                  bytes: mint.toString(),
                },
              },
            ],
          }
        );

        const accountsToWithdrawFrom = [];

        for (const accountInfo of allAccounts) {
          const account = unpackAccount(
            accountInfo.pubkey,
            accountInfo.account,
            TOKEN_2022_PROGRAM_ID
          );

          const transferFeeAmount = getTransferFeeAmount(account);

          if (transferFeeAmount && transferFeeAmount.withheldAmount > 0) {
            accountsToWithdrawFrom.push(accountInfo.pubkey);
          }
        }

        if (accountsToWithdrawFrom.length === 0) {
          setMessage("No fees available to withdraw.");
          continue; // Continue to the next token
        }

        const transactionSignature = await withdrawWithheldTokensFromAccounts(
          connection,
          payerWallet.payer,
          mint,
          associatedTokenAccount, // Use the created or existing token account
          withdrawWithheldAuthority.payer,
          [],
          accountsToWithdrawFrom,
          undefined,
          TOKEN_2022_PROGRAM_ID
        );

        console.log("Withdrawal Transaction Signature:", transactionSignature);
        setMessage("Fees successfully withdrawn!");
      } catch (error) {
        console.error("Error collecting transfer fees:", error);
        setMessage("Error collecting transfer fees: " + error.message);
      }
    }

    setLoading(false); // Stop loading state after processing all tokens
  };

  const withheldAmount = async () => {
    setMessage(""); // Clear previous messages
    let totalWithheldFee = BigInt(0); // Track the total withheld fee as BigInt

    for (const token of deployedTokens) {
      const mint = new PublicKey(token.address);

      try {
        // Fetch all accounts associated with the token mint
        const allAccounts = await connection.getProgramAccounts(
          TOKEN_2022_PROGRAM_ID,
          {
            commitment: "confirmed",
            filters: [
              {
                memcmp: {
                  offset: 0,
                  bytes: mint.toString(),
                },
              },
            ],
          }
        );

        for (const accountInfo of allAccounts) {
          const account = unpackAccount(
            accountInfo.pubkey,
            accountInfo.account,
            TOKEN_2022_PROGRAM_ID
          );

          const transferFeeAmount = getTransferFeeAmount(account);
          console.log("Total Withheld Fee:", totalWithheldFee.toString()); // Use toString() for BigInt

          if (transferFeeAmount && transferFeeAmount.withheldAmount > 0) {
            // Ensure withheldAmount is also treated as BigInt
            totalWithheldFee += BigInt(transferFeeAmount.withheldAmount);
            console.log("Withheld Amount:", transferFeeAmount.withheldAmount); // Log individual withheld amounts
          }
        }
      } catch (error) {
        console.error("Error withheldAmount:", error);
        setMessage("Error withheldAmount: " + error.message);
      }
    }
    const decimals = 9;
    setWithheldFee(totalWithheldFee.toString() / 10 ** decimals); // Update state with total as a string
    console.log(
      "Total Withheld Fee:",
      totalWithheldFee.toString() / 10 ** decimals
    ); // Log total withheld fee after loop
  };

  // Burn Tokens
  const burnTokens = async () => {
    if (!burnAmount) {
      setMessage("Enter amount to burn.");
      return;
    }
    const decimals = 9;
    const payer = window.solana.publicKey;
    let tokenAddress;
    for (const token of deployedTokens) {
      tokenAddress = new PublicKey(token.address);
      try {
      } catch (error) {
        console.error(`Error deployedTokens for ${token.symbol}:`, error);
      }
    }
    const associatedToken = getAssociatedTokenAddressSync(
      new PublicKey(tokenAddress),
      payer,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const burnTransaction = new Transaction().add(
      createBurnInstruction(
        associatedToken,
        new PublicKey(tokenAddress),
        payer,
        BigInt(burnAmount * 10 ** decimals), // Burn amount in smallest unit
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    burnTransaction.recentBlockhash = blockhash;
    burnTransaction.feePayer = payer;

    try {
      const signedTransaction = await window.solana.signTransaction(
        burnTransaction
      );
      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize()
      );
      await connection.confirmTransaction(signature, "processed");
      alert(`Token burned successfully!\nAmount:${burnAmount}\n`);

      // Use setTimeout to ensure that the new tab opens after the alert is dismissed
      setTimeout(() => {
        window.open(
          `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
          "_blank"
        );
      }, 100); // 100 milliseconds delay
    } catch (error) {
      console.error("Token burn error:", error);
      setMessage("Token burn failed.");
    }
  };

  // Mint Tokens
  const mintTokens = async () => {
    if (!mintToPublicKey || !mintAmount) {
      setMessage("Enter valid PublicKey and mint amount.");
      return;
    }
    const decimals = 9;
    const payer = window.solana.publicKey;
    let tokenAddress;
    for (const token of deployedTokens) {
      tokenAddress = new PublicKey(token.address);
      try {
      } catch (error) {
        console.error(`Error deployedTokens for ${token.symbol}:`, error);
      }
    }
    const associatedToken = getAssociatedTokenAddressSync(
      new PublicKey(tokenAddress),
      new PublicKey(mintToPublicKey),
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const accountTransaction = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        associatedToken,
        new PublicKey(mintToPublicKey),
        new PublicKey(tokenAddress),
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    // Sign and submit accountTransaction
    const { blockhash: accountBlockhash } =
      await connection.getLatestBlockhash();
    accountTransaction.recentBlockhash = accountBlockhash;
    accountTransaction.feePayer = payer;

    const signedAccountTransaction = await window.solana.signTransaction(
      accountTransaction
    );
    const serializedAccountTransaction = signedAccountTransaction.serialize();
    const accountSignature = await connection.sendRawTransaction(
      serializedAccountTransaction
    );
    await connection.confirmTransaction(accountSignature, "processed");

    // setMessage(
    //   `Token and associated token account created successfully! Account Signature: ${accountSignature}`
    // );

    // Minting tokens after account creation
    const amount = mintAmount
      ? BigInt(mintAmount * Math.pow(10, decimals))
      : 0n; // Default to 0 if mintAmount is invalid

    const mintToTransaction = new Transaction().add(
      createMintToInstruction(
        new PublicKey(tokenAddress),
        associatedToken,
        payer,
        amount,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    const { blockhash: mintBlockhash } = await connection.getLatestBlockhash();
    mintToTransaction.recentBlockhash = mintBlockhash;
    mintToTransaction.feePayer = payer;

    // Sign and send mint transaction
    const signedMintTransaction = await window.solana.signTransaction(
      mintToTransaction
    );
    const serializedMintTransaction = signedMintTransaction.serialize();
    const mintSignature = await connection.sendRawTransaction(
      serializedMintTransaction
    );
    await connection.confirmTransaction(mintSignature, "processed");

    alert(
      `Tokens minted successfully! \nAmount: ${mintAmount} \nWallet: ${mintToPublicKey} `
    );

    // Use setTimeout to ensure that the new tab opens after the alert is dismissed
    setTimeout(() => {
      window.open(
        `https://explorer.solana.com/tx/${mintSignature}?cluster=devnet`,
        "_blank"
      );
    }, 100); // 100 milliseconds delay

    // setMessage(`Tokens minted successfully! Mint Signature: ${mintSignature}`);
  };

  useEffect(() => {
    if (walletConnected) {
      fetchUserBalance();
    }
  }, [walletConnected]);

  return (
    <div className="App">
      <h2>Solana Token Management</h2>
      <button className="phantom-connect-button" onClick={connectPhantom}>
        <h3>
          {walletConnected ? (
            <>
              Connected: {walletAddress.substring(0, 5)}...
              {walletAddress.substring(walletAddress.length - 4)}
              <span className="balance-display">
                Balance: {balance.toFixed(4)} SOL
              </span>{" "}
              <div>
                {deployedTokens.length > 0 && (
                  <>
                    <ul>
                      <li key={deployedTokens[0].address}>
                        Token Balance:{" "}
                        {tokenBalances[deployedTokens[0].symbol] || 0}{" "}
                        {deployedTokens[0].symbol}{" "}
                      </li>
                    </ul>
                  </>
                )}
              </div>
            </>
          ) : (
            "Connect Phantom Wallet"
          )}
        </h3>
      </button>

      {walletConnected && (
        <>
          <div className="input-container">
            <h3>Create Token</h3>
            <input
              type="text"
              placeholder="Token Name"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
            />
            <input
              type="text"
              placeholder="Token Symbol"
              value={tokenSymbol}
              onChange={(e) => setTokenSymbol(e.target.value)}
            />
            <button onClick={createToken} disabled={deployedTokens.length > 0}>
              Create Token
            </button>
          </div>
          <div className="input-container">
            <h3>Mint Tokens</h3>
            <input
              type="text"
              placeholder="Recipient PublicKey"
              value={mintToPublicKey}
              onChange={(e) => setMintToPublicKey(e.target.value)}
            />
            <input
              type="number"
              placeholder="Amount to Mint"
              value={mintAmount || ""}
              onChange={(e) => setMintAmount(e.target.value)}
            />

            <button onClick={mintTokens}>Mint Tokens</button>
          </div>
          <div className="input-container">
            <h3>Burn Tokens</h3>
            <input
              type="number"
              placeholder="Amount to Burn"
              value={burnAmount || ""}
              onChange={(e) => setBurnAmount(e.target.value)}
            />
            <button onClick={burnTokens}>Burn Tokens</button>
          </div>
          <div className="fee-container">
            <h3>Collect Transfer Fee</h3>

            <div className="fee-info">
              <label>Claimable Tokens :</label>
              <span>
                {withheldFee || 0} {deployedTokens?.[0]?.symbol || ""}
              </span>
            </div>

            <button
              className="claim-button"
              onClick={collectTransferFee}
              disabled={loading}
            >
              {loading ? "Claiming..." : "Claim "}
            </button>
          </div>
        </>
      )}
      {message && <div className="message">{message}</div>}
    </div>
  );
};

export default App;
