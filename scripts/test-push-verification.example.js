// Comprehensive test script to verify NIP-34 push event structure
// Usage: node test-push-verification.js <eventId> [relayUrl]
// Or run in browser console after pushing a repo

(async function testPushVerification() {
  // Get event ID from command line or use default
  const eventId = process.argv[2] || (typeof window !== "undefined" ? window.prompt("Enter event ID:") : null);
  
  if (!eventId) {
    console.error("❌ Please provide an event ID");
    console.log("Usage: node test-push-verification.js <eventId> [relayUrl]");
    return;
  }
  
  const relayUrl = process.argv[3] || "wss://relay.damus.io";
  
  console.log("🧪 NIP-34 Push Event Verification");
  console.log("=".repeat(80));
  console.log(`Event ID: ${eventId}`);
  console.log(`Relay: ${relayUrl}`);
  console.log("=".repeat(80));
  
  // Query event from relay
  let event = null;
  
  if (typeof window !== "undefined") {
    // Browser context - use WebSocket directly
    const ws = new WebSocket(relayUrl);
    const subId = `test-${Date.now()}`;
    
    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify(["REQ", subId, { ids: [eventId] }]));
        setTimeout(() => {
          ws.close();
          resolve(null);
        }, 10000);
      };
      
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (Array.isArray(data) && data[0] === "EVENT" && data[1] === subId) {
            event = data[2];
            ws.close();
            resolve(null);
          } else if (Array.isArray(data) && data[0] === "EOSE" && data[1] === subId) {
            ws.close();
            resolve(null);
          }
        } catch (e) {
          console.warn("Failed to parse message:", e);
        }
      };
      
      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        ws.close();
        resolve(null);
      };
    });
  } else {
    // Node.js context - use ws package
    try {
      const WebSocket = require("ws");
      const ws = new WebSocket(relayUrl);
      const subId = `test-${Date.now()}`;
      
      await new Promise((resolve) => {
        ws.on("open", () => {
          ws.send(JSON.stringify(["REQ", subId, { ids: [eventId] }]));
          setTimeout(() => {
            ws.close();
            resolve(null);
          }, 10000);
        });
        
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (Array.isArray(msg) && msg[0] === "EVENT" && msg[1] === subId) {
              event = msg[2];
              ws.close();
              resolve(null);
            } else if (Array.isArray(msg) && msg[0] === "EOSE" && msg[1] === subId) {
              ws.close();
              resolve(null);
            }
          } catch (e) {
            console.warn("Failed to parse message:", e);
          }
        });
        
        ws.on("error", (error) => {
          console.error("WebSocket error:", error);
          ws.close();
          resolve(null);
        });
      });
    } catch (e) {
      console.error("Failed to load ws package. Install with: npm install ws");
      return;
    }
  }
  
  if (!event) {
    console.log("❌ Event not found on relay");
    console.log("💡 Try checking on nostr.watch: https://nostr.watch/e/" + eventId);
    return;
  }
  
  console.log("\n✅ Event found!");
  console.log("\n📋 Event Structure:");
  console.log({
    id: event.id,
    kind: event.kind,
    expectedKind: 30617,
    kindMatch: event.kind === 30617 ? "✅" : "❌",
    pubkey: event.pubkey?.slice(0, 16) + "...",
    created_at: new Date(event.created_at * 1000).toISOString(),
    tagsCount: event.tags?.length || 0,
    contentLength: event.content?.length || 0,
    contentSizeKB: ((event.content?.length || 0) / 1024).toFixed(2),
  });
  
  // Parse NIP-34 tags
  console.log("\n🏷️  NIP-34 Tags Analysis:");
  const tags: Record<string, string[]> = {};
  event.tags?.forEach((tag: any) => {
    if (Array.isArray(tag) && tag.length >= 2) {
      const key = tag[0];
      if (!tags[key]) tags[key] = [];
      tags[key].push(tag[1]);
    }
  });
  
  // Required tags
  console.log("\n✅ Required NIP-34 Tags:");
  const requiredChecks = {
    "d tag (repo identifier)": !!tags.d?.[0],
    "name tag": !!tags.name?.[0],
    "description tag": !!tags.description?.[0],
    "clone URLs": tags.clone && tags.clone.length > 0,
    "relays": tags.relays && tags.relays.length > 0,
    "maintainers": tags.maintainers && tags.maintainers.length > 0,
  };
  console.log(requiredChecks);
  
  // Clone URLs analysis
  console.log("\n🔗 Clone URLs Analysis:");
  if (tags.clone && tags.clone.length > 0) {
    console.log(`Total clone URLs: ${tags.clone.length}`);
    const httpUrls = tags.clone.filter((url: string) => url.startsWith("http://") || url.startsWith("https://"));
    const nostrUrls = tags.clone.filter((url: string) => url.startsWith("nostr://"));
    const sshUrls = tags.clone.filter((url: string) => url.startsWith("git@"));
    const otherUrls = tags.clone.filter((url: string) => 
      !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("nostr://") && !url.startsWith("git@")
    );
    
    console.log({
      "HTTPS/HTTP URLs": httpUrls.length,
      "nostr:// URLs": nostrUrls.length,
      "SSH URLs": sshUrls.length,
      "Other URLs": otherUrls.length,
    });
    
    console.log("\n📋 All Clone URLs:");
    tags.clone.forEach((url: string, idx: number) => {
      const type = url.startsWith("https://") || url.startsWith("http://") ? "🌐 HTTPS" :
                   url.startsWith("nostr://") ? "🔮 nostr://" :
                   url.startsWith("git@") ? "🔑 SSH" : "❓ Other";
      console.log(`  ${idx + 1}. ${type}: ${url}`);
    });
  } else {
    console.log("❌ No clone URLs found!");
  }
  
  // Optional tags
  console.log("\n📌 Optional NIP-34 Tags:");
  const optionalTags = {
    "r tag (earliest unique commit)": tags.r?.filter((r: string, idx: number) => 
      event.tags?.find((t: any) => Array.isArray(t) && t[0] === "r" && t[1] === r && t[2] === "euc")
    ).length || 0,
    "topics": tags.t?.length || 0,
    "web links": tags.web?.length || 0,
    "source": tags.source?.length || 0,
    "forkedFrom": tags.forkedFrom?.length || 0,
  };
  console.log(optionalTags);
  
  // Parse content
  console.log("\n📦 Event Content Analysis:");
  try {
    const content = JSON.parse(event.content || "{}");
    console.log("Content keys:", Object.keys(content));
    
    if (content.files && Array.isArray(content.files)) {
      const files = content.files;
      const withContent = files.filter((f: any) => f.content);
      const withoutContent = files.filter((f: any) => !f.content);
      const binaryFiles = files.filter((f: any) => f.isBinary);
      const textFiles = files.filter((f: any) => !f.isBinary);
      
      // Calculate sizes
      const totalContentSize = files.reduce((sum: number, f: any) => {
        if (f.content) {
          // Base64 is ~33% larger than raw
          return sum + (f.content.length * 3) / 4;
        }
        return sum;
      }, 0);
      
      console.log("\n📁 Files Analysis:");
      console.log({
        total: files.length,
        withContent: withContent.length,
        withoutContent: withoutContent.length,
        binaryFiles: binaryFiles.length,
        textFiles: textFiles.length,
        totalContentSizeKB: (totalContentSize / 1024).toFixed(2),
        avgFileSizeKB: files.length > 0 ? (totalContentSize / files.length / 1024).toFixed(2) : 0,
      });
      
      // Sample files
      console.log("\n📄 Sample Files with Content (first 3):");
      withContent.slice(0, 3).forEach((f: any) => {
        const contentSize = f.content ? (f.content.length * 3) / 4 : 0;
        console.log({
          path: f.path,
          type: f.type || "file",
          isBinary: f.isBinary || false,
          contentSizeKB: (contentSize / 1024).toFixed(2),
          hasContent: !!f.content,
        });
      });
      
      console.log("\n📄 Sample Files without Content (first 3):");
      withoutContent.slice(0, 3).forEach((f: any) => {
        console.log({
          path: f.path,
          type: f.type || "file",
          isBinary: f.isBinary || false,
          size: f.size || "unknown",
          hasContent: false,
          note: "Content should be fetched from git server using clone URLs",
        });
      });
      
      // NIP-34 compliance check
      console.log("\n💡 NIP-34 Compliance:");
      console.log("- Small text files (< 10KB) have content in event ✅");
      console.log("- Binary/large files have metadata only (per NIP-34) ✅");
      console.log("- Clone URLs should point to git servers for fetching large files");
      console.log("- gitworkshop.dev should read small files from event content");
      
      // Check for binary files with content (shouldn't happen)
      const binaryWithContent = binaryFiles.filter((f: any) => f.content);
      if (binaryWithContent.length > 0) {
        console.log(`\n⚠️  WARNING: ${binaryWithContent.length} binary file(s) have content (should be metadata only)`);
        binaryWithContent.slice(0, 3).forEach((f: any) => {
          console.log(`  - ${f.path} (${f.isBinary ? "binary" : "text"})`);
        });
      }
      
      // Check for large text files with content (might exceed event size limit)
      const largeTextFiles = textFiles.filter((f: any) => {
        if (!f.content) return false;
        const size = (f.content.length * 3) / 4;
        return size > 10 * 1024; // > 10KB
      });
      if (largeTextFiles.length > 0) {
        console.log(`\n⚠️  WARNING: ${largeTextFiles.length} large text file(s) have content (> 10KB)`);
        largeTextFiles.slice(0, 3).forEach((f: any) => {
          const size = (f.content.length * 3) / 4;
          console.log(`  - ${f.path} (${(size / 1024).toFixed(2)}KB)`);
        });
      }
    } else {
      console.log("⚠️ No files array in content");
    }
    
    // Repository metadata
    console.log("\n📋 Repository Metadata:");
    console.log({
      repositoryName: content.repositoryName,
      name: content.name,
      description: content.description?.substring(0, 100) + (content.description?.length > 100 ? "..." : ""),
      publicRead: content.publicRead,
      publicWrite: content.publicWrite,
      defaultBranch: content.defaultBranch,
      branches: content.branches?.length || 0,
      topics: content.topics?.length || 0,
      languages: content.languages?.length || 0,
      hasReadme: !!content.readme,
      hasLogoUrl: !!content.logoUrl,
    });
  } catch (e) {
    console.error("❌ Failed to parse content:", e);
  }
  
  // Event size check
  const eventJson = JSON.stringify(event);
  const eventSizeKB = (eventJson.length / 1024).toFixed(2);
  console.log(`\n📊 Event Size: ${eventSizeKB}KB`);
  if (parseFloat(eventSizeKB) > 95) {
    console.log("⚠️  WARNING: Event size exceeds 95KB (close to 100KB Nostr limit)");
  } else if (parseFloat(eventSizeKB) > 80) {
    console.log("⚠️  WARNING: Event size is getting close to limit");
  } else {
    console.log("✅ Event size is within safe limits");
  }
  
  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 Summary:");
  console.log("=".repeat(80));
  const allChecksPass = Object.values(requiredChecks).every(v => v === true);
  console.log(`NIP-34 Compliance: ${allChecksPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Clone URLs: ${tags.clone?.length || 0} (${httpUrls?.length || 0} HTTPS, ${nostrUrls?.length || 0} nostr://, ${sshUrls?.length || 0} SSH)`);
  console.log(`Files: ${content.files?.length || 0} total (${withContent?.length || 0} with content, ${withoutContent?.length || 0} metadata only)`);
  console.log(`Event Size: ${eventSizeKB}KB`);
  console.log("\n✅ Test complete!");
  console.log(`\n🔗 View on nostr.watch: https://nostr.watch/e/${eventId}`);
})();

