import { 
  scanPendingOts, 
  upgradeTimestamp, 
  verifyTimestamp, 
  createSha256File,
  logEvent 
} from './lib/ots-manager.js';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const CHECK_INTERVAL = 60000; // 60 секунди

// ============================================================
// ФОНОВ ПРОЦЕС ЗА UPGRADE И VERIFY
// Запазете това работещо във фонов режим
// ============================================================

async function processQueue() {
  console.log(`🔄 [${new Date().toISOString()}] Проверка за чакащи печати...`);
  
  const otsFiles = scanPendingOts();
  
  if (otsFiles.length === 0) {
    console.log('   📭 Няма чакащи печати.');
    return;
  }
  
  console.log(`   📄 Намерени ${otsFiles.length} чакащи печата.`);
  
  for (const otsPath of otsFiles) {
    try {
      // 1. Опитваме upgrade
      const upgradeResult = await upgradeTimestamp(otsPath);
      
      if (upgradeResult.status === 'complete') {
        console.log(`   ✅ Завършен: ${otsPath}`);
        
        // 2. Верификация
        const verifyResult = await verifyTimestamp(otsPath);
        
        if (verifyResult.verified) {
          // 3. Създаваме .sha256 файл
          const sha256Path = createSha256File(otsPath, verifyResult);
          console.log(`   📄 Създаден: ${sha256Path}`);
          logEvent(`Печатът ${otsPath} е завършен и верифициран`, 'success');
        }
      } else if (upgradeResult.status === 'pending') {
        console.log(`   ⏳ Все още чака: ${otsPath}`);
      } else if (upgradeResult.status === 'error') {
        console.log(`   ❌ Грешка при ${otsPath}: ${upgradeResult.error}`);
        logEvent(`Грешка при ${otsPath}: ${upgradeResult.error}`, 'error');
      }
      
    } catch (err) {
      console.error(`   ❌ Неочаквана грешка при ${otsPath}: ${err.message}`);
      logEvent(`Неочаквана грешка при ${otsPath}: ${err.message}`, 'error');
    }
  }
  
  console.log(`⏳ Следваща проверка след ${CHECK_INTERVAL/1000} секунди.\n`);
}

// ============================================================
// СТАРТИРАНЕ НА ФОНОВИЯ ПРОЦЕС
// ============================================================

// Ако е извикан директно
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔄 Фонов процес за OpenTimestamps стартира...');
  console.log(`⏱️ Интервал на проверка: ${CHECK_INTERVAL/1000} секунди`);
  console.log('📂 Наблюдава: ./data/pending/\n');
  console.log('   Натиснете Ctrl+C за спиране\n');
  
  // Първоначално изпълнение
  await processQueue();
  
  // Периодични проверки
  setInterval(processQueue, CHECK_INTERVAL);
}

export { processQueue };