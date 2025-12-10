/**
 * Utility to check if files exist in localStorage for a repository
 * Run in browser console: checkRepoFiles(entity, repo)
 * 
 * Example:
 *   checkRepoFiles("npub1k5f85zx0xdskyayqpfpc0zq6n7vwqjuuxugkayk72fgynp34cs3qfcvqg2", "BTClock")
 *   checkRepoFiles("npub1k5f85zx0xdskyayqpfpc0zq6n7vwqjuuxugkayk72fgynp34cs3qfcvqg2", "btclock-webui")
 *   checkRepoFiles("npub1k5f85zx0xdskyayqpfpc0zq6n7vwqjuuxugkayk72fgynp34cs3qfcvqg2", "webui")
 */

export function checkRepoFiles(entity: string, repo: string): {
  found: boolean;
  key?: string;
  fileCount?: number;
  files?: any[];
  repoInList?: any;
} {
  if (typeof window === 'undefined') {
    console.error("This script must be run in the browser");
    return { found: false };
  }

  // Try different possible repo names (original, slugified, lowercase)
  const possibleRepos = [
    repo,
    repo.toLowerCase(),
    repo.replace(/-/g, '_'),
    repo.replace(/_/g, '-'),
  ];

  // Also check all repos in localStorage to find matching ones
  const allRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
  const matchingRepos = allRepos.filter((r: any) => {
    const repoEntity = r.entity || r.ownerPubkey;
    const repoName = r.repo || r.slug || r.name || "";
    
    // Check entity match
    const entityMatches = repoEntity === entity || 
      (repoEntity && entity && repoEntity.toLowerCase() === entity.toLowerCase());
    
    // Check repo name match (try all variations)
    const repoMatches = possibleRepos.some(possibleRepo => 
      repoName.toLowerCase() === possibleRepo.toLowerCase() ||
      repoName.toLowerCase().includes(possibleRepo.toLowerCase()) ||
      possibleRepo.toLowerCase().includes(repoName.toLowerCase())
    );
    
    return entityMatches && repoMatches;
  });

  console.log(`🔍 Checking files for ${entity}/${repo}`);
  console.log(`📦 Found ${matchingRepos.length} matching repo(s) in localStorage:`, matchingRepos.map((r: any) => ({
    entity: r.entity,
    repo: r.repo || r.slug,
    name: r.name,
    fileCount: r.fileCount,
    hasFilesInRepo: !!(r.files && Array.isArray(r.files) && r.files.length > 0),
  })));

  // Check files in repo object
  for (const repoData of matchingRepos) {
    if (repoData.files && Array.isArray(repoData.files) && repoData.files.length > 0) {
      console.log(`✅ Found ${repoData.files.length} files in repo object`);
      return {
        found: true,
        fileCount: repoData.files.length,
        files: repoData.files,
        repoInList: repoData,
      };
    }
  }

  // Check separate files storage key
  for (const possibleRepo of possibleRepos) {
    const filesKey = `gittr_files__${entity}__${possibleRepo}`;
    const stored = localStorage.getItem(filesKey);
    
    if (stored) {
      try {
        const files = JSON.parse(stored);
        if (Array.isArray(files) && files.length > 0) {
          console.log(`✅ Found ${files.length} files in separate storage key: ${filesKey}`);
          return {
            found: true,
            key: filesKey,
            fileCount: files.length,
            files: files,
          };
        }
      } catch (e) {
        console.error(`Failed to parse files from ${filesKey}:`, e);
      }
    }
  }

  // List all gittr_files keys to help debug
  const allFilesKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("gittr_files__")) {
      allFilesKeys.push(key);
    }
  }

  console.log(`❌ No files found for ${entity}/${repo}`);
  console.log(`📋 All gittr_files keys in localStorage (${allFilesKeys.length} total):`, allFilesKeys);

  return { found: false };
}

// Make it available globally in browser console
if (typeof window !== 'undefined') {
  (window as any).checkRepoFiles = checkRepoFiles;
}

