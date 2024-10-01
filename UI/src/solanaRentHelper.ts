import { TokenAccountNotFoundError, getNewAccountLenForExtensionLen, ExtensionType, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { pack, TokenMetadata } from '@solana/spl-token-metadata';

export async function getAdditionalRentForNewMetadata(connection, address, tokenMetadata, programId = TOKEN_2022_PROGRAM_ID) {
    const info = await connection.getAccountInfo(address);
    if (!info) {
        throw new TokenAccountNotFoundError();
    }

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

    const newRentExemptMinimum = await connection.getMinimumBalanceForRentExemption(newAccountLen);

    return newRentExemptMinimum - info.lamports;
}
