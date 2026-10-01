import 'dotenv/config';
import app from './app';
import { checkPgvectorExtension } from './db/supabase';

const PORT = process.env.PORT || 3000;

async function main(): Promise<void> {
  await checkPgvectorExtension();

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
