SECONDS_BETWEEN_BLOCKS = 60;
INITIAL_TARGET = 0x0000cfffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
DIFFICULTY_ADJUSTMENT_INTERVAL = 40; // blocks
MAX_DIFFICULTY_CHANGE = 0.25; // 25%
MAX_BLOCK_SIZE_BYTES = 5_000; // bytes
MAX_CHAIN_LENGTH = 50; // after which we snapshot and prune the last

if (DIFFICULTY_ADJUSTMENT_INTERVAL > MAX_CHAIN_LENGTH) {
    throw new Error('DIFFICULTY_ADJUSTMENT_INTERVAL cannot be greater than MAX_CHAIN_LENGTH');
}