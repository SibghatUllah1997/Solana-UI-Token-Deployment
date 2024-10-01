import React, { useState } from 'react';
import {
    Connection,
    Keypair,
    Transaction,
    SystemProgram,
    clusterApiUrl,
    PublicKey,
} from '@solana/web3.js';
import {
    getMinimumBalanceForRentExemption,
    getMintLen,
    ExtensionType,
    createInitializeMintInstruction,
    createInitializeTransferFeeConfigInstruction,
    createInitializeMetadataPointerInstruction,
    TOKEN_2022_PROGRAM_ID,
    createInitializeTransferHookInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountIdempotentInstruction,
    createMintToInstruction
} from '@solana/spl-token';

import { Buffer } from 'buffer';

// Polyfill for Buffer
window.Buffer = Buffer;

const App = () => {
    const [message, setMessage] = useState('');
    const [walletConnected, setWalletConnected] = useState(false);
    const [walletAddress, setWalletAddress] = useState(null);
    const [tokenName, setTokenName] = useState('');
    const [tokenSymbol, setTokenSymbol] = useState('');
    const [tokenURI, setTokenURI] = useState(''); // State for Token URI
    const network = clusterApiUrl('devnet');
    const connection = new Connection(network, 'confirmed');

    const connectPhantom = async () => {
        if (window.solana && window.solana.isPhantom) {
            try {
                const { publicKey } = await window.solana.connect();
                setWalletAddress(publicKey.toString());
                setWalletConnected(true);
                setMessage(`Connected to wallet: ${publicKey.toString()}`);
            } catch (err) {
                console.error('Connection error:', err);
                setMessage('Connection to Phantom wallet failed.');
            }
        } else {
            setMessage('Phantom wallet not found. Please install it from the Phantom website.');
        }
    };

    const createToken = async () => {
        if (!walletConnected) {
            setMessage('Wallet not connected. Please connect your Phantom wallet.');
            return;
        }

        if (!tokenName || !tokenSymbol || !tokenURI) { // Check for token URI
            setMessage('Please enter token name, symbol, and URI.');
            return;
        }
    
        const extensions = [
            ExtensionType.TransferFeeConfig,
            ExtensionType.MetadataPointer,
            ExtensionType.TransferHook,
        ];
    
        const mintLen = getMintLen(extensions);
        const payer = window.solana.publicKey;
        const mintKeypair = Keypair.generate();
        const decimals = 9;
        const feeBasisPoints = 100; // 1%
        const maxFee = BigInt(1000000);
    
        try {
            const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);
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
    
            // Initialize transfer hook
            const transferHookInstruction = createInitializeTransferHookInstruction(
                mintKeypair.publicKey,
                payer,
                new PublicKey("71KWoZM3r9KgkCrY5d5keYH4z7c8poJQBHpyZVmPAcnQ"),
                TOKEN_2022_PROGRAM_ID
            );
            mintTransaction.add(transferHookInstruction);
    
            // Initialize transfer fee config
            const initTransferFeeConfig = createInitializeTransferFeeConfigInstruction(
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
            const signedTransaction = await window.solana.signTransaction(mintTransaction);
            const serializedTransaction = signedTransaction.serialize();
            const signature = await connection.sendRawTransaction(serializedTransaction);
            await connection.confirmTransaction(signature, 'processed');
    
            const response = await fetch('http://localhost:3001/create-metadata', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
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
                const transactionBuffer = Buffer.from(data.transaction, 'base64');
                const transaction = Transaction.from(transactionBuffer);
    
                // Sign the transaction with Phantom wallet
                const signedMetadataTransaction = await window.solana.signTransaction(transaction);
    
                // Serialize and send the transaction
                const serializedMetadataTransaction = signedMetadataTransaction.serialize();
                const metadataSignature = await connection.sendRawTransaction(serializedMetadataTransaction);
                await connection.confirmTransaction(metadataSignature, 'processed');
    
                setMessage('Token created successfully with metadata!');
                console.log('Transaction signature:', metadataSignature);
            } else {
                setMessage(`Error creating metadata: ${data.error}`);
                console.error('Error creating metadata:', data.error);
            }
    
            // Creating the associated token account
            const associatedToken = getAssociatedTokenAddressSync(mintKeypair.publicKey, payer, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    
            const accountTransaction = new Transaction().add(
                createAssociatedTokenAccountIdempotentInstruction(
                    payer,
                    associatedToken,
                    payer,
                    mintKeypair.publicKey,
                    TOKEN_2022_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                )
            );
    
            // Sign and submit accountTransaction
            const { blockhash: accountBlockhash } = await connection.getLatestBlockhash();
            accountTransaction.recentBlockhash = accountBlockhash;
            accountTransaction.feePayer = payer;
    
            const signedAccountTransaction = await window.solana.signTransaction(accountTransaction);
            const serializedAccountTransaction = signedAccountTransaction.serialize();
            const accountSignature = await connection.sendRawTransaction(serializedAccountTransaction);
            await connection.confirmTransaction(accountSignature, 'processed');
    
            setMessage(`Token and associated token account created successfully! Account Signature: ${accountSignature}`);
    
            // Minting tokens after account creation
            const mintAmount = BigInt(10 * Math.pow(10, decimals)); // Mint 1,000,000 tokens
            const mintToTransaction = new Transaction().add(
                createMintToInstruction(mintKeypair.publicKey, associatedToken, payer, mintAmount, [], TOKEN_2022_PROGRAM_ID)
            );
    
            const { blockhash: mintBlockhash } = await connection.getLatestBlockhash();
            mintToTransaction.recentBlockhash = mintBlockhash;
            mintToTransaction.feePayer = payer;
    
            // Sign and send mint transaction
            const signedMintTransaction = await window.solana.signTransaction(mintToTransaction);
            const serializedMintTransaction = signedMintTransaction.serialize();
            const mintSignature = await connection.sendRawTransaction(serializedMintTransaction);
            await connection.confirmTransaction(mintSignature, 'processed');
    
            setMessage(`Tokens minted successfully! Mint Signature: ${mintSignature}`);
    
        } catch (error) {
            console.error('Error creating token:', error);
            setMessage('Error creating token. Please check console for details.');
        }
    };

    return (
        <div className="App">
            <h1>Create Solana Token</h1>
            <button onClick={connectPhantom}>
                {walletConnected ? `Wallet Connected: ${walletAddress}` : 'Connect Phantom Wallet'}
            </button>
            <div>
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
                <input
                    type="text"
                    placeholder="Token URI"
                    value={tokenURI}
                    onChange={(e) => setTokenURI(e.target.value)} // Handle URI input
                />
                <button onClick={createToken}>Create Token</button>
            </div>
            {message && <p>{message}</p>}
        </div>
    );
};

export default App;
