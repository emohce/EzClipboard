const assert = require('assert');
const fs = require('fs');

// Simple syntax test for the modified functions
const ref = (val) => ({ value: val });
const nextTick = (fn) => setTimeout(fn, 0);

// Mock the functions to test syntax
const activeIndex = ref(0);
const showList = ref([]);
const keyHoldTimer = ref(null);
const keyHoldDirection = ref(null);
const keyHoldStartTime = ref(0);

const KEY_HOLD_DELAY = 300;
const KEY_HOLD_REPEAT_INTERVAL = 150;

const isAtTopBoundary = () => {
    return activeIndex.value <= 0;
};

const isAtBottomBoundary = () => {
    return activeIndex.value >= showList.value.length - 1;
};

const stopKeyHold = () => {
    if (keyHoldTimer.value) {
        clearTimeout(keyHoldTimer.value);
        keyHoldTimer.value = null;
    }
    keyHoldDirection.value = null;
    keyHoldStartTime.value = 0;
};

const startKeyHoldAutoScroll = (direction) => {
    keyHoldDirection.value = direction;
    keyHoldStartTime.value = Date.now();
    
    keyHoldTimer.value = setTimeout(() => {
        const autoScroll = () => {
            if (!keyHoldDirection.value) return;
            
            const elapsed = Date.now() - keyHoldStartTime.value;
            const acceleratedInterval = Math.max(50, KEY_HOLD_REPEAT_INTERVAL - Math.floor(elapsed / 1000) * 10);
            
            keyHoldTimer.value = setTimeout(autoScroll, acceleratedInterval);
        };
        
        autoScroll();
    }, KEY_HOLD_DELAY);
};

const sqliteRepositorySource = fs.readFileSync(
    'src/storage/sqliteClipboardRepository.js',
    'utf8',
);

assert.ok(
    sqliteRepositorySource.includes('item.collected === true && !force'),
    'SQLite removeItems must check collection state from the row it already selected',
);
assert.ok(
    !sqliteRepositorySource.includes('this.isCollected(id) && !force'),
    'SQLite removeItems must not reference an undefined id variable',
);
assert.ok(
    sqliteRepositorySource.includes('collected: row.collected === 1'),
    'rowToItem must map the collected column, otherwise per-row collect checks are always false',
);
assert.ok(
    sqliteRepositorySource.includes('new Set(this.selectCollectedIds())'),
    'collectIdSet must be built from all collected ids, not the TAB_CACHE_LIMIT-truncated cache',
);

console.log('Syntax test passed - no errors found');
