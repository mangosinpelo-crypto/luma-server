import supabase from './services/supabase.js';

async function fetchUserMemory() {
  console.log("=== INSPECTING SUPABASE MEMORY & EPISODES DATA ===\n");
  
  // 1. Fetch memory_state table
  const { data: memoryData, error: memErr } = await supabase
    .from('memory_state')
    .select('*');
    
  if (memErr) {
    console.error("Error reading memory_state:", memErr);
  } else {
    console.log(`Found ${memoryData.length} memory_state records:`);
    for (const m of memoryData) {
      console.log(`\nUser ID: ${m.user_id}`);
      console.log(`Emotional State: Afinidad=${m.afinidad}, Enojo=${m.enojo}, Cansancio=${m.cansancio}, Ansiedad=${m.ansiedad}, Aburrimiento=${m.aburrimiento}, Resentimiento=${m.resentimiento}, Celos=${m.celos}, Nostalgia=${m.nostalgia}`);
      console.log(`Rasgos Identidad:`, JSON.stringify(m.rasgos_identidad));
      console.log(`Arquetipo ID: ${m.arquetipo_id}`);
      console.log(`Dias Activos:`, JSON.stringify(m.dias_activos));
      console.log(`Memory State (JSON):`, JSON.stringify(m.memory_state, null, 2));
      console.log(`Chat History Items in DB: ${Array.isArray(m.chat_history) ? m.chat_history.length : 0}`);
      if (Array.isArray(m.chat_history) && m.chat_history.length > 0) {
        console.log("  Sample Chat History (Last 3):");
        m.chat_history.slice(-3).forEach((item, idx) => {
          console.log(`    [${idx}] Role: ${item.role} | Content: ${str(item.content).substring(0, 100)}`);
        });
      }
    }
  }

  // 2. Fetch episodes table
  const { data: episodeData, error: epErr } = await supabase
    .from('episodes')
    .select('*')
    .order('created_at', { ascending: false });
    
  if (epErr) {
    console.error("Error reading episodes:", epErr);
  } else {
    console.log(`\nFound ${episodeData ? episodeData.length : 0} episodes recorded:`);
    (episodeData || []).forEach(ep => {
      console.log(`  [${ep.created_at}] User: ${ep.user_id} | Episode Text: "${ep.text}"`);
    });
  }

  // 3. Fetch users table
  const { data: userData, error: userErr } = await supabase
    .from('users')
    .select('*');
    
  if (userErr) {
    console.error("Error reading users:", userErr);
  } else {
    console.log(`\nFound ${userData ? userData.length : 0} user records:`);
    (userData || []).forEach(u => {
      console.log(`  User ID: ${u.id} | Tier: ${u.tier} | Daily Msg Count: ${u.daily_message_count} | Reset: ${u.daily_message_reset}`);
    });
  }

  process.exit(0);
}

function str(val) {
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

fetchUserMemory();
