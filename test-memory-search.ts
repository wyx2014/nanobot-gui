import { MemoryManager } from './src/core/memory/index.ts';

async function testSearch() {
  const mm = new MemoryManager();
  console.log("Searching for '偏好'...");
  const results = await mm.search("偏好", { limit: 5 });
  console.log("Results for '偏好':", JSON.stringify(results, null, 2));

  console.log("Searching for '技术问题'...");
  const results2 = await mm.search("技术问题", { limit: 5 });
  console.log("Results for '技术问题':", JSON.stringify(results2, null, 2));
}

testSearch().catch(console.error);
