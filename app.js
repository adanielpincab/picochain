const gun = GUN(['http://localhost:8999/gun']);

let storedKeys = localStorage.getItem('node_keys');
let node_keys;
if (storedKeys) {
    node_keys = JSON.parse(storedKeys);
    console.log("✅ Loaded keys from localStorage:", node_keys.pub);
} else {
    node_keys = await GUN.SEA.pair();
    localStorage.setItem('node_keys', JSON.stringify(node_keys));
    console.log("✅ Generated new keys:", node_keys.pub);
}

await gun.user().auth(node_keys, ack => {
if (ack.err) {
    console.error("❌ User AUTH error:", ack.err);
} else {
    console.log("✅ Node user created with keys:", node_keys.pub);
    gun.get('signaling').get(node_keys.pub).put({role: 'node'});
}
});

let keys;
let storedWalletKeys = localStorage.getItem('wallet_keys');
if (storedWalletKeys) {
    keys = JSON.parse(storedWalletKeys);
    console.log("✅ Loaded wallet keys from localStorage");
} else {
    keys = generateKeyPairHex();
    localStorage.setItem('wallet_keys', JSON.stringify(keys));
    console.log("✅ Generated new wallet keys");
}
let address = await addressFromPublicKeyHex(keys.pub);

let blockchain = new Blockchain();

class Mempool {
    constructor() {
        this.transactions = [];
    }

    addTransaction(tx) {
        this.transactions.push(tx);
    }

    async hasTransaction(transactionHash) {
        return this.transactions.some(async tx => await tx.hash() === transactionHash);
    }

    serialize() {
        return this.transactions.map(tx => tx.toJSON());
    }

    async cleanUp() {
        let cleanMempool = [];
        const hashes = new Set();

        for (let tx of this.transactions) {
            if (await blockchain.isValidTransaction(tx) && !hashes.has(await tx.hash())) {
                cleanMempool.push(tx);
                hashes.add(await tx.hash());
            }
        }

        this.transactions = cleanMempool;
    }
}
let mempool = new Mempool();

let acknowledgedPeers = new Set();
async function listenToPeer(pubKey) {
    if (pubKey === node_keys.pub) return; // don't listen to self

    gun.get('~' + pubKey).get('blockchain').on(async (data, key) => {
		let peerBlockchain = Blockchain.fromJSON(JSON.parse(data));
        console.log(await peerBlockchain.getTotalWork(), await blockchain.getTotalWork())
        if (!await validateFullChain(peerBlockchain)) return;
        if (await peerBlockchain.getTotalWork() <= await blockchain.getTotalWork()) return;
        console.log('✅⛓️🤝 Better blockchain received from peer:', pubKey);
        Object.assign(blockchain, peerBlockchain);
        await mempool.cleanUp();
        broadcastMyChain();

        resetWorker();
        mine(address);
    });

    gun.get('~' + pubKey).get('mempool').on(async (data, key) => {
        let newTransactions = false;
        let receivedMempool = JSON.parse(data);
        for (let txData of receivedMempool) {
            let transaction = Transaction.fromJSON(txData);
            if (await mempool.hasTransaction(await transaction.hash()) || await blockchain.hasTransactionHash(await transaction.hash())) {
                console.log('ℹ️📨 Duplicate transaction received from peer has been ignored:', pubKey, transaction);
                continue;
            };
            if (!await blockchain.isValidTransaction(transaction)) {
                console.log('❌📨 Invalid transaction received from peer has been ignored:', pubKey, transaction);
                continue;
            }
            console.log('✅📨 New valid transaction received from peer:', pubKey, transaction);
            mempool.addTransaction(transaction);
            newTransactions = true;
        }
        if (!newTransactions) return;
        await mempool.cleanUp();
        broadcastMyMempool();
        resetWorker();
        mine(address);
    });
}

gun.get('signaling').map().on(async (data, key) => {
    if (acknowledgedPeers.has(key)) return;
    console.log('🧿🤝 Discovered peer:', key, data);
    acknowledgedPeers.add(key);
    listenToPeer(key);
});

function broadcastMyChain() {
    const myChainString = blockchain.toString();
    gun.user().get('blockchain').put(myChainString);
}

async function broadcastMyMempool() {
    await mempool.cleanUp();
    let memPoolString = JSON.stringify(mempool.serialize());
    gun.user().get('mempool').put(memPoolString);
}

let worker = new Worker('mining.worker.js');
function resetWorker() {
	if (worker) {
		worker.terminate();
    }
    worker = new Worker('mining.worker.js');
}

let mining = false;
async function mine(miningAddress) {
	if (!mining) return;
    await mempool.cleanUp();
    worker.postMessage({blockchain: blockchain.toJSON(), rewardAddress: miningAddress, mempool: mempool.serialize()});
    worker.onmessage = async function(e) {
        const block = Block.fromJSON(e.data.block);
        try {
            await blockchain.addBlock(block);
            broadcastMyChain();
        } catch (error) {
            console.error("Error adding block:", error);
        }
        console.log('✅📦 Mined new block:', await block.hash());
        console.log('Blockchain target:', blockchain.target);
        console.log('Blockchain bytes size:', roughSizeOfObject(blockchain), 'bytes');
        console.log('Blockchain total work average:', await blockchain.getTotalWork());

        worker.postMessage({blockchain: blockchain.toJSON(), rewardAddress: miningAddress, mempool: mempool.serialize()});
        broadcastMyChain();
	}
}

function toggleMining() {
    if (mining) {
        mining = false;
        worker.terminate();
        console.log('⛏️🛑[MINER] Stopped mining.');
    } else {
        mining = true;
		console.log('⛏️🟢[MINER] Resumed mining.');
		resetWorker();
        mine(address);
    }
}

async function updateUI() {
	let balance  = blockchain.getConfirmedBalance(address);
    document.getElementById('debug-wallet-address').textContent = address;
    document.getElementById('debug-wallet-balance').textContent = balance;
    document.getElementById('debug-blockchain').textContent = JSON.stringify(Array.from(blockchain.chain).reverse(), null, 2);
	document.getElementById('debug-mempool').textContent = await Promise.all(mempool.transactions.map(async tx => await Transaction.fromJSON(tx).hash() + '<br>' + JSON.stringify(tx))).then(results => results.join('<br><br>'));

    UI.update(
        address,
        balance,
        blockchain,
		mempool,
		mining
    );
}

async function sendTransaction(recipientAddress, amount) {
    const amountNano = Math.floor(amount * UNITS_PER_COIN);
    const transaction = new Transaction(address, recipientAddress, amountNano);
    await transaction.sign(keys.priv);
    mempool.addTransaction(transaction);
    await broadcastMyMempool(transaction);
    console.log('✅📨 Created and broadcasted transaction:', transaction);
}

document.getElementById('debug-send-button').addEventListener('click', (e) => {
    e.preventDefault();
    const recipientAddress = document.getElementById('debug-recipient-address').value;
    const amount = parseFloat(document.getElementById('debug-transfer-amount').value);
    sendTransaction(recipientAddress, amount);
});

root.querySelector("#main-miner-toggle").addEventListener('click', () => {
	toggleMining();
});

root.querySelector("#send-panel-submit").addEventListener('click', () => {
	let recipientAddress = root.querySelector("#send-recipient-address").value;
	let amount = parseFloat(root.querySelector("#send-amount").value);
	sendTransaction(recipientAddress, amount);
	UI.gotoRootView("main");
});

setInterval(async () => {
    await updateUI();
}, 1500);
