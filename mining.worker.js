importScripts('imports/elliptic.min.js');
importScripts('crypto.js');
importScripts('consensus.js');
importScripts('blockchain.js');

onmessage = async function(e) {
    let blockchain = Blockchain.fromJSON(e.data.blockchain);
    let block = await blockchain.getBlockTemplate();
    let mempool = e.data.mempool.map(txData => Transaction.fromJSON(txData));
    let fees = 0;
    for (let tx of mempool) {
        if (!await blockchain.isValidTransaction(tx)) {
            console.log('[Miner] Invalid transaction in mempool, not added to block:', tx);
            continue;
        }
        block.addTransaction(tx);
        fees += tx.fee;
    }
    let reward = new CoinBaseTransaction(e.data.rewardAddress, blockchain.getBlockReward(block.index) + fees);
    block.addTransaction(reward);
    while (!await blockchain.validToInsert(block)) {
        await block.newNonce();
    }
    postMessage({block: block.toJSON()});
}