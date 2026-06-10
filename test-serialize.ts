import { serializeExpertMd } from './src/core/expert/registry';
try {
  const md = serializeExpertMd({ name: 'test', description: 'test desc' }, 'hello world');
  console.log('SUCCESS:', JSON.stringify(md));
} catch (err) {
  console.error('ERROR:', err);
}
