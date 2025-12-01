function addressFromPublicKey(publicKey) {
    const hash = sjcl.hash.sha256.hash(sjcl.codec.hex.toBits(publicKey));
    return 'PC' + sjcl.codec.hex.fromBits(hash);
}

function addressFromPrivateKey(privateKey) {
    const publicKey = sjcl.ecc.ecdsa.publicKeyFromSecret(privateKey).toString();
    return addressFromPublicKey(publicKey);
}

class Transaction {
    constructor(from, to, amount) {
        this.from = from;
        this.to = to;
        this.amount = amount; // in NANO (1 PC = 1,000,000,000,000 NANO)
        this.fee = 0;
        this.timestamp = Date.now();
        this.type = 'standard';
        this.signature = null; // [publicKey, signature(txhash)]
    }

    async hash() {
        return await sha256hex(
            this.from + 
            this.to + 
            this.amount +
            this.fee +
            this.timestamp
        );
    }

    async sign(privateKey) {
        const hash = await this.hash();
        const signature = sjcl.ecc.ecdsa.sign(
            sjcl.hash.sha256,
            sjcl.codec.hex.toBits(hash),
            privateKey
        );
        this.signature = sjcl.codec.hex.fromBits(signature);
    }

    async verify() {
        if (!this.signature) return false;

        let signingPubKey = this.signature[0];
        let signature = this.signature[1];
        let signingAddress = addressFromPublicKey(signingPubKey);

        if (signingAddress !== this.from) return false;

        const publicKey = sjcl.ecc.ecdsa.publicKeyFromHex(signingPubKey);
        const hash = await this.hash();
        const signatureBits = sjcl.codec.hex.toBits(signature);
        return sjcl.ecc.ecdsa.verify(
            publicKey,
            signatureBits,
            sjcl.codec.hex.toBits(hash)
        );
    }
}

class CoinBaseTransaction extends Transaction {
    constructor(to, amount) {
        super(null, to, amount);
        this.type = 'coinbase';
    }

    async verify() { return true; }
}

class Block {
    constructor(index, previousHash, timestamp = Date.now()) {
        this.index = index;
        this.timestamp = timestamp;
        this.transactions = [];
        this.previousHash = previousHash;
        this.nonce = 0;
    }

    addTransaction(tx) {
        this.transactions.push(tx);
    }

    async hash() {
        return await sha256hex(
            this.index + 
            this.previousHash + 
            this.timestamp + 
            JSON.stringify(this.data) + 
            this.nonce
        );
    }

    newNonce() {
        this.timestamp = Date.now();
        this.nonce++;
    }

    toJSON() {
        return {
            index: this.index,
            timestamp: this.timestamp,
            transactions: this.transactions,
            previousHash: this.previousHash,
            nonce: this.nonce
        };
    }

    static fromJSON(json) {
        return Object.assign(new Block(), json);
    }
}

class Blockchain {
    constructor() {
        this.snapshot = {};
        this.target = INITIAL_TARGET;
        this.chain = [new Block(0, 1764244761572, {}, '0')];
    }

    toJSON() {
        return {
            snapshot: this.snapshot,
            target: this.target,
            chain: this.chain.map(b => b.toJSON())
        };
    }

    length(self) {
        if (this.snapshot.height === undefined) {
            return this.chain.length;
        }
        return this.snapshot.height + this.chain.length;
    }

    toString() {
        return JSON.stringify(this.toJSON());
    }

    async getTotalWorkAverage() {
        let max = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
        let totalWork = 0;
        for (let block of this.chain) {
            totalWork += max/(parseInt(await block.hash(), 16)+1);
        }
        return totalWork / this.chain.length;
    }

    static fromJSON(json) {
        const blockchain = new Blockchain();
        blockchain.snapshot = json.snapshot;
        blockchain.target = json.target;
        blockchain.chain = json.chain.map(b => Block.fromJSON(b));
        return blockchain;
    }

    static fromString(string) {
        return Blockchain.fromJSON(JSON.parse(string));
    }

    recomputeTarget() {
        if ( 
            (this.chain[this.chain.length-1].index % DIFFICULTY_ADJUSTMENT_INTERVAL != 0) || 
            (this.chain.length < DIFFICULTY_ADJUSTMENT_INTERVAL) ) { return; }

        const blockBack = this.chain[this.chain.length - DIFFICULTY_ADJUSTMENT_INTERVAL];
        const timeExpected = SECONDS_BETWEEN_BLOCKS * DIFFICULTY_ADJUSTMENT_INTERVAL * 1000;
        const timeTaken = this.chain[this.chain.length - 1].timestamp - blockBack.timestamp;
        let newTarget = (this.target * timeTaken) / timeExpected;
        const maxIncrease = this.target * (1 + MAX_DIFFICULTY_CHANGE);
        const maxDecrease = this.target * (1 - MAX_DIFFICULTY_CHANGE);
        if (newTarget > maxIncrease) newTarget = maxIncrease;
        if (newTarget < maxDecrease) newTarget = maxDecrease;
        this.target = newTarget;
    }

    async validToInsert(block) {
        const previousBlock = this.chain[this.chain.length - 1];
        if (block.index !== previousBlock.index + 1) { console.log("Block index is invalid"); return false; }
        if (
            (block.timestamp >  Date.now() + 5000) ||
            (block.timestamp < previousBlock.timestamp)
        ) { return false; }
        if (block.previousHash !== await previousBlock.hash()) { return false; }
        if (parseInt(await block.hash(), 16) > this.target) { return false; }
        if (roughSizeOfObject(block) > MAX_BLOCK_SIZE_BYTES) { return false; }
        if (!this.verifyBlockTransactions(block)) { return false; }
        
        return true;
    }

    async addBlock(newBlock) {
        if (!await this.validToInsert(newBlock)) {
            throw new Error('Block invalid for the current chain.');
        }

        this.chain.push(newBlock);
        this.recomputeTarget();

        if (this.chain.length > MAX_CHAIN_LENGTH) {
            let prunedBlock = this.chain.shift();

            this.snapshot.height = prunedBlock.index;
            this.snapshot.lastBlockHash = await prunedBlock.hash();
            this.snapshot.lastBlockTimestamp = prunedBlock.timestamp;
            if (!this.snapshot.ledger) this.snapshot.ledger = {};
            for (let tx of prunedBlock.transactions || []) {
                if (true || await tx.verify()) {
                    if (tx.from) {
                        this.snapshot.ledger[tx.from] -= (tx.amount + tx.fee);
                    }
                    if (this.snapshot.ledger[tx.to]) {
                        this.snapshot.ledger[tx.to] += tx.amount;
                    } else {
                        this.snapshot.ledger[tx.to] = tx.amount;
                    }

                    if (this.snapshot.ledger[tx.from] === 0) {
                        delete this.snapshot.ledger[tx.from];
                    }
                }
            }
        }

        return true;
    }

    async getBlockTemplate() {
        const previousBlock = this.chain[this.chain.length - 1];
        const newIndex = previousBlock.index + 1;
        const newPreviousHash = await previousBlock.hash();
        return new Block(newIndex, newPreviousHash);
    }

    getLength() {
        return this.snapshot.height + this.chain.length;
    }

    getBlockReward(blockIndex) {
        const halvings = Math.floor(blockIndex / HALVING_INTERVAL_BLOCKS);
        const initialReward = 5_000_000_000_000; // nanoPC
        return Math.floor(initialReward / Math.pow(2, halvings));
    }

    getConfirmedBalance(address) {
        let balance = 0;
        if (this.snapshot.ledger && this.snapshot.ledger[address]) {
            balance += this.snapshot.ledger[address];
        }
        for (let block of this.chain) {
            for (let transaction of block.transactions || []) {
                if (transaction.to === address) {
                    balance += transaction.amount;
                }
            }
        }
        return balance;
    }

    verifyBlockTransactions(block) {
        if (block.transactions.filter(tx => tx.type === 'coinbase').length > 1) {
            return false;
        }

        let fees = 0;
        let txIndex = 0;
        for (let tx of block.transactions || []) {
            if (tx.type === 'coinbase') { txIndex++; continue; }
            if (!tx.verify()) { return false; }
            
            const fromAddress = tx.from;
            let balance = this.getConfirmedBalance(fromAddress);
            for (let i = 0; i < txIndex; i++) {
                let priorTx = block.transactions[i];
                if (priorTx.from === fromAddress) {
                    balance -= (priorTx.amount + priorTx.fee);
                } else if (priorTx.to === fromAddress) {
                    balance += priorTx.amount;
                }
            }
            fees += tx.fee;
            if (balance < (tx.amount + tx.fee)) { return false; }
            balance -= (tx.amount + tx.fee);
            txIndex++;
        }

        let block_reward = this.getBlockReward(block.index);
        let coinbase = block.transactions.find(tx => tx.type === 'coinbase');
        if (coinbase) {
            if (coinbase.amount !== (block_reward + fees)) {
                return false;
            }
        }

        return true;
    }
}

async function validateFullChain(blockchain) {
    let test = new Blockchain();

    if (Object.keys(blockchain.snapshot).length === 0) {
        // chain with genesis, no snapshot
        for (let block of blockchain.chain.slice(1)) {
            if (!test.validToInsert(block)) {
                return false;
            }
            await test.addBlock(block);
        }
    } else {
        // chain with snapshot
        test.chain = [blockchain.chain[0]];
        test.snapshot = Object.assign({}, blockchain.snapshot);
        for (let block of blockchain.chain.slice(1)) {
            if (!test.validToInsert(block)) {
                return false;
            }
            await test.addBlock(block);
        }
    }

    return true;
}