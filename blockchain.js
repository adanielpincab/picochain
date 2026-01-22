async function addressFromPublicKeyHex(publicKeyHex) {
    const hash = await sha256Hex(publicKeyHex);
    const doubleHash = await sha256Hex(hash);
    return 'PC_' + doubleHash.slice(-40);
}

async function addressFromPrivateKeyHex(privateKeyHex) {
    const publicKeyHex = publicKeyHexFromPrivateKeyHex(privateKeyHex);
    return await addressFromPublicKeyHex(publicKeyHex);
}

class Transaction {
    constructor(from, to, amount) {
        this.from = from;
        this.to = to;
        this.amount = amount;
        this.fee = 0;
        this.timestamp = Date.now();
        this.type = 'standard';
        this.signature = null; // [publicKey, signature(txhash)]
    }

    async hash() {
        return await sha256Hex(
            this.from +
            this.to +
            this.amount +
            this.fee +
            this.type +
            this.timestamp
        );
    }

    async sign(privateKey) {
        const hash = await this.hash();
        const signature = signHash(privateKey, hash);
        const publicKeyHex = publicKeyHexFromPrivateKeyHex(privateKey);
        this.signature = [publicKeyHex, signature];
        return this.signature !== null && this.signature !== undefined;
    }

    async verify() {
        if (!this.signature) return false;

        let signingPublicKeyHex = this.signature[0];
        let signature = this.signature[1];
        let signingAddress = await addressFromPublicKeyHex(signingPublicKeyHex);

        if (signingAddress !== this.from) return false;

        return verifySignature(signingPublicKeyHex, await this.hash(), signature);
    }

    toJSON() {
        return {
            from: this.from,
            to: this.to,
            amount: this.amount,
            fee: this.fee,
            timestamp: this.timestamp,
            type: this.type,
            signature: this.signature
        };
    }

    static fromJSON(json) {
        const tx = Object.assign(new Transaction(), json);
        return tx;
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
        return await sha256Hex(
            this.index +
            this.previousHash +
            this.timestamp +
            JSON.stringify(this.transactions) +
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

    async getTotalWork() {
        let max = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
        let totalWork = 0;
        for (let block of this.chain) {
            totalWork += max/(parseInt(await block.hash(), 16)+1);
        }
        return totalWork;
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
        if (!await this.verifyBlockTransactions(block)) { return false; }

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
                if (await tx.verify()) {
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
        const initialReward = REWARD_AMOUNT_INITIAL;
        return Math.floor(initialReward / Math.pow(2, halvings));
    }

    async hasTransactionHash(transactionHash) {
        for (let block of this.chain) {
            if (block.transactions) {
                for (let transaction of block.transactions) {
                    transaction = Transaction.fromJSON(transaction);
                    if (await transaction.hash() == transactionHash) {
                        return true;
                    }
                }
            }
        }
        return false;
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
                if (transaction.from === address) {
                    balance -= (transaction.amount + transaction.fee);
                }
            }
        }
        return balance;
	}

	getLatestTransactions(address, number) {
		let latestTransactions = [];
		for (let block of this.chain.toReversed()) {
			for (let transaction of block.transactions || []) {
                if (transaction.to === address || transaction.from === address) {
					latestTransactions.push(transaction);
					if (latestTransactions.length >= number) {
						return latestTransactions;
					}
                }
            }
		}
		return latestTransactions;
	}

	async isValidTransaction(transaction) {
        return (
            await transaction.verify() &&
            (this.getConfirmedBalance(transaction.from) >= (transaction.amount + transaction.fee)) &&
            !await this.hasTransactionHash(await transaction.hash())
        );
    }

    async verifyBlockTransactions(block) {
        if (block.transactions.filter(tx => tx.type === 'coinbase').length > 1) {
            return false;
        }

        let fees = 0;
        let txIndex = 0;
        for (let tx of block.transactions || []) {
            let transaction = Transaction.fromJSON(tx);

            if (transaction.type === 'coinbase') { txIndex++; continue; }
            if (!await transaction.verify()) { return false; }

            const fromAddress = transaction.from;
            let balance = this.getConfirmedBalance(fromAddress);
            for (let i = 0; i < txIndex; i++) {
                let priorTx = Transaction.fromJSON(block.transactions[i]);
                if (priorTx.from === fromAddress) {
                    balance -= (priorTx.amount + priorTx.fee);
                } else if (priorTx.to === fromAddress) {
                    balance += priorTx.amount;
                }
            }
            fees += transaction.fee;
            if (balance < (transaction.amount + transaction.fee)) { return false; }
            balance -= (transaction.amount + transaction.fee);
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
