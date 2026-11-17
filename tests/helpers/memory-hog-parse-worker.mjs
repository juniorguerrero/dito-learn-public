// Test double: a parser that keeps allocating until it runs out of heap.
const keep = [];
for (;;) keep.push(new Array(100_000).fill({ page: keep.length }));
