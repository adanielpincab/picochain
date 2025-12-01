importScripts('imports/sjcl.js');
importScripts('crypto.js');
importScripts('consensus.js');
importScripts('blockchain.js');

onmessage = async function(e) {
    let blockchain = Blockchain.fromJSON(e.data.blockchain);
    let block = await blockchain.getBlockTemplate();
    let reward = new CoinBaseTransaction('addrTest', blockchain.getBlockReward(block.index));
    block.addTransaction(reward);
    while (!await blockchain.validToInsert(block)) {
        await block.newNonce();
    }
    postMessage({block: block.toJSON()});
}