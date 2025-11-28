const gun = GUN(['http://localhost:8080/gun']);
const node_keys = await GUN.SEA.pair();
await gun.user().auth(node_keys, ack => {
if (ack.err) {
    console.error("❌ User AUTH error:", ack.err);
} else {
    console.log("✅ Node user created with SEA.pair():", node_keys.pub);
    gun.get('signaling').get(node_keys.pub).put({role: 'node'});
}
});

const blockchainDOM = document.getElementById('blockchain');
let blockchain = new Blockchain();

async function listenToPeer(pubKey) {
    if (pubKey === node_keys.pub) return; // don't listen to self
    gun.get('~' + pubKey).get('blockchain').on(async (data, key) => {
        let peerBlockchain = Blockchain.fromJSON(JSON.parse(data));
        if (!await validateFullChain(peerBlockchain)) return;
        if (peerBlockchain.length() <= blockchain.length()) return;
        console.log('✅ Valid longer blockchain received from peer:', pubKey);
        Object.assign(blockchain, peerBlockchain);
        resetWorker();
        mine();
    });
}

gun.get('signaling').map().on(async (data, key) => {
    console.log('Discovered peer:', key, data);
    listenToPeer(key);
});

async function broadcastMyChain() {
    const myChainString = blockchain.toString();
    gun.user().get('blockchain').put(myChainString);
}

let worker = new Worker('mining.worker.js');
function resetWorker() {
    worker.terminate();
    worker = new Worker('mining.worker.js');
}

async function mine() {
    worker.postMessage({blockchain: blockchain.toJSON()});
    worker.onmessage = async function(e) {
        const block = Block.fromJSON(e.data.block);
        try {
            await blockchain.addBlock(block);
            broadcastMyChain();
        } catch (error) {
            console.error("Error adding block:", error);
        }
        console.log('Mined new block:', await block.hash());
        console.log('Blockchain valid:', await validateFullChain(blockchain));
        console.log('Blockchain target:', blockchain.target);
        blockchainDOM.innerHTML = JSON.stringify(blockchain, null, 2);

        worker.postMessage({blockchain: blockchain.toJSON()});
        broadcastMyChain();
    }
}
mine();