SECONDS_BETWEEN_BLOCKS = 60;
INITIAL_TARGET = 0x0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
DIFFICULTY_ADJUSTMENT_INTERVAL = 10; // blocks
MAX_DIFFICULTY_CHANGE = 0.25; // 25%
MAX_BLOCK_SIZE_BYTES = 5_000; // bytes
MAX_CHAIN_LENGTH = 1_440; // after which we snapshot and prune the last

UNITS_PER_COIN = 1_000_000_000_000; // nano units
REWARD_AMOUNT_INITIAL = 5 * UNITS_PER_COIN;
HALVING_INTERVAL_BLOCKS = 210_000;

if (DIFFICULTY_ADJUSTMENT_INTERVAL > MAX_CHAIN_LENGTH) {
    throw new Error('DIFFICULTY_ADJUSTMENT_INTERVAL cannot be greater than MAX_CHAIN_LENGTH');
}