import React, { useState, useEffect } from 'react';

const PhantomConnect = ({ setWalletAddress }) => {
  const [walletConnected, setWalletConnected] = useState(false);

  const connectWallet = async () => {
    if (window.solana) {
      try {
        const resp = await window.solana.connect();
        setWalletAddress(resp.publicKey.toString());
        setWalletConnected(true);
      } catch (err) {
        console.error("Wallet connection error:", err);
      }
    } else {
      alert("Phantom wallet not found! Please install it.");
    }
  };

  useEffect(() => {
    if (window.solana && window.solana.isPhantom) {
      setWalletConnected(true);
    }
  }, []);

  return (
    <div>
      {walletConnected ? (
        <button disabled>Connected</button>
      ) : (
        <button onClick={connectWallet}>Connect Phantom Wallet</button>
      )}
    </div>
  );
};

export default PhantomConnect;
