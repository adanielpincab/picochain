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
        this.amount = amount;
        this.timestamp = Date.now();
    }

    async hash() {
        return await sha256hex(
            this.from + 
            this.to + 
            this.amount +
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

    async verify(publicKey) {
        const hash = await this.hash();
        const signatureBits = sjcl.codec.hex.toBits(this.signature);
        return sjcl.ecc.ecdsa.verify(
            publicKey,
            signatureBits,
            sjcl.codec.hex.toBits(hash)
        );
    }
}

class Block {
    constructor(index, timestamp, data, previousHash) {
        this.index = index;
        this.timestamp = timestamp;
        this.data = data;
        this.previousHash = previousHash;
        this.nonce = 0;
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
            data: this.data,
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
        return this.snapshot.height + this.chain.length;
    }

    toString() {
        return JSON.stringify(this.toJSON());
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
        if (block.index !== previousBlock.index + 1) { return false; }
        if (
            (block.timestamp >  Date.now() + 5000) ||
            (block.timestamp < previousBlock.timestamp)
        ) { return false; }
        if (block.previousHash !== await previousBlock.hash()) { return false; }
        if (parseInt(await block.hash(), 16) > this.target) { return false; }
        if (roughSizeOfObject(block) > MAX_BLOCK_SIZE_BYTES) { return false; }
        
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
            if (this.snapshot.ledger) {
                // TODO: update ledger from prunedBlock transactions
            }
        
        }

        return true;
    }

    async getBlockTemplate() {
        const previousBlock = this.chain[this.chain.length - 1];
        const newIndex = previousBlock.index + 1;
        const newTimestamp = Date.now();
        const newData = {};
        const newPreviousHash = await previousBlock.hash();

        return new Block(newIndex, newTimestamp, newData, newPreviousHash);
    }

    getLength() {
        return this.snapshot.height + this.chain.length;
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