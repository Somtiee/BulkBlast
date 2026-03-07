import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedNftAsset, DetectedNftItem, NftStandard } from '../types/nft';
import { Buffer } from 'buffer';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export const NftDetectionService = {
  /**
   * Detects the standard of a list of NFT mints.
   * Groups them by collection/group.
   */
  async detectAndGroupNfts(
    connection: Connection,
    mints: string[],
    owner: string
  ): Promise<DetectedNftAsset[]> {
    if (mints.length === 0) return [];

    // 1. Fetch Mint Account Info (Owner Program)
    const mintPubkeys = mints.map(m => new PublicKey(m));
    
    // Batch fetch mint accounts
    const accountInfos = await this.batchGetAccounts(connection, mintPubkeys);

    // 2. Fetch Metadata Account Info (Token Standard)
    const metadataPDAs = mintPubkeys.map(mint => 
      PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        METADATA_PROGRAM_ID
      )[0]
    );
    
    // Batch fetch metadata (chunked)
    const metadataInfos = await this.batchGetAccounts(connection, metadataPDAs);

    const groupedMap = new Map<string, DetectedNftAsset>();

    for (let i = 0; i < mints.length; i++) {
      const mint = mints[i];
      const mintInfo = accountInfos[i];
      const metaInfo = metadataInfos[i];

      let standard: NftStandard = 'unknown';
      let groupName = 'Unknown Collection';
      let groupId = 'misc_items';
      let collectionId: string | undefined;
      let name = 'Unknown NFT';
      let uri = '';

      if (!mintInfo) {
        standard = 'unknown';
      } else if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        standard = 'token2022_asset';
        groupId = 'token2022_collection'; 
        groupName = 'Token-2022 Assets';
      } else if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        standard = 'standard_spl_nft'; // default
        
        if (metaInfo) {
          try {
            const parsed = this.parseMetadata(metaInfo.data);
            name = parsed.name || 'Unknown NFT';
            uri = parsed.uri || '';
            
            // Use collection key if available, otherwise fallback to symbol or first word of name
            if (parsed.collection?.key) {
               groupId = parsed.collection.key;
               collectionId = parsed.collection.key;
               groupName = parsed.name.split('#')[0].trim() || 'Collection'; 
            } else if (parsed.symbol) {
               groupId = parsed.symbol;
               groupName = parsed.symbol + ' Collection';
            } else {
               // Fallback: group by first word of name
               const firstWord = name.split(' ')[0];
               if (firstWord.length > 2) {
                  groupId = firstWord.toLowerCase();
                  groupName = firstWord;
               }
            }

            // Token Standard Enum:
            // 0: NonFungible, 1: FungibleAsset, 2: Fungible, 3: NonFungibleEdition, 4: ProgrammableNonFungible
            if (parsed.tokenStandard === 4) {
              standard = 'programmable_nft';
            } else if (parsed.tokenStandard === 1) {
              standard = 'semi_fungible';
            }
          } catch (e) {
            console.warn(`Failed to parse metadata for ${mint}`, e);
          }
        }
      }

      // Create or update group
      if (!groupedMap.has(groupId)) {
        groupedMap.set(groupId, {
          groupId: groupId,
          groupName: groupName,
          items: [],
          ownedCount: 0,
          imageUri: uri,
          standard: standard,
          tokenProgram: mintInfo?.owner?.toBase58()
        });
      }

      const group = groupedMap.get(groupId)!;
      
      // Improve Group Name if better one found
      if (group.groupName === 'Unknown Collection' && groupName !== 'Unknown Collection') {
         group.groupName = groupName;
      }
      // If we found a real collection ID/Key later, upgrade the group ID?
      // No, we already used the collection Key if available.

      // Add item
      group.items.push({
         mint,
         name,
         uri,
         standard
      });
      group.ownedCount++;
    }

    // Post-processing
    // Merge groups that appear to be the same collection but were split (e.g. by symbol vs name)
    // Or just resolve names.
    
    // 1. Resolve names via URI fetch for "Unknown" groups
    const result = Array.from(groupedMap.values());
    const unknownGroups = result.filter(g => g.groupName === 'Unknown Collection' || g.groupName.startsWith('Unnamed'));
    
    await Promise.all(unknownGroups.map(async (group) => {
        if (group.items.length === 0) return;
        const item = group.items[0];
        if (!item.uri) return;

        try {
            const response = await fetch(item.uri);
            const json = await response.json();
            
            if (json.collection && json.collection.name) {
                group.groupName = json.collection.name;
            } else if (json.symbol) {
                 group.groupName = json.symbol + ' Collection';
            }
        } catch (e) {
            // ignore
        }
    }));

    // 2. Final heuristic for remaining unknowns
    for (const g of result) {
       if ((g.groupName === 'Unknown Collection' || g.groupName.startsWith('Unnamed')) && g.items.length > 0) {
          // Fallback to name prefix
          const first = g.items[0].name;
          const prefix = first.split(' #')[0];
          if (prefix && prefix !== first && prefix.length > 2) {
             g.groupName = prefix;
          } else {
             g.groupName = first; // Just use item name if single
          }
       }
    }
    
    // 3. Regroup by name (Merge split groups)
    // Sometimes on-chain metadata is inconsistent (some items have collection key, some don't but share name)
    const mergedMap = new Map<string, DetectedNftAsset>();
    
    for (const g of result) {
       const key = g.groupName; // Group by Name now
       if (!mergedMap.has(key)) {
          mergedMap.set(key, { ...g, items: [...g.items] });
       } else {
          const existing = mergedMap.get(key)!;
          existing.items.push(...g.items);
          existing.ownedCount += g.ownedCount;
          // Keep the "best" standard/image?
          if (!existing.imageUri && g.imageUri) existing.imageUri = g.imageUri;
       }
    }
    
    return Array.from(mergedMap.values());
  },

  async batchGetAccounts(connection: Connection, keys: PublicKey[]) {
    const results = [];
    const chunkSize = 100;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      const infos = await connection.getMultipleAccountsInfo(chunk);
      results.push(...infos);
    }
    return results;
  },

  parseMetadata(buffer: Buffer) {
    try {
        // Basic check for account data size to prevent out-of-bounds
        if (buffer.length < 64) throw new Error('Buffer too small for metadata');

        let offset = 1; // Start after key
        
        // Skip updateAuthority (32) and mint (32)
        offset += 64;

        const readString = () => {
           if (offset + 4 > buffer.length) throw new Error('Buffer overflow reading string length');
           const len = buffer.readUInt32LE(offset);
           offset += 4;
           
           if (offset + len > buffer.length) throw new Error('Buffer overflow reading string content');
           const str = buffer.slice(offset, offset + len).toString('utf8').replace(/\0/g, '').trim();
           offset += len;
           return str;
        };

        const name = readString();
        const symbol = readString();
        const uri = readString();
        
        // Debug Log
        // console.log(`Parsed Metadata: ${name} | ${symbol} | ${uri}`);

        offset += 2; // SellerFeeBasisPoints

        // Creators (Optional)
        if (offset >= buffer.length) return { name, symbol, uri, tokenStandard: undefined, collection: undefined };
        const hasCreators = buffer[offset];
        offset += 1;
        if (hasCreators) {
          if (offset + 4 > buffer.length) throw new Error('Buffer overflow reading creators len');
          const creatorsLen = buffer.readUInt32LE(offset);
          offset += 4;
          offset += creatorsLen * 34; 
        }

        offset += 1; // PrimarySaleHappened
        offset += 1; // IsMutable

        // Edition Nonce (Optional)
        if (offset >= buffer.length) return { name, symbol, uri, tokenStandard: undefined, collection: undefined };
        const hasEditionNonce = buffer[offset];
        offset += 1;
        if (hasEditionNonce) offset += 1;

        // Token Standard (Optional)
        let tokenStandard: number | undefined;
        if (offset < buffer.length) {
           const hasTokenStandard = buffer[offset];
           offset += 1;
           if (hasTokenStandard) {
             if (offset < buffer.length) {
                tokenStandard = buffer[offset];
                offset += 1;
             }
           }
        }

        // Collection (Optional)
        let collection: { key: string, verified: boolean } | undefined;
        if (offset < buffer.length) {
           const hasCollection = buffer[offset];
           offset += 1;
           if (hasCollection) {
             const verified = buffer[offset] === 1;
             offset += 1;
             if (offset + 32 <= buffer.length) {
                const key = new PublicKey(buffer.slice(offset, offset + 32)).toBase58();
                collection = { key, verified };
                offset += 32;
             }
           }
        }

        return { name, symbol, uri, tokenStandard, collection };
    } catch (e) {
        // console.warn('Parse Error:', e);
        return { name: 'Unknown', symbol: '', uri: '', tokenStandard: undefined, collection: undefined };
    }
  }
};
