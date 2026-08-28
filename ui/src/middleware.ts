import { searchParamsHaveAbsurdRepoPath } from "@/lib/repos/repo-path-sanity";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Cheap 404 for crawler nest ?path= / ?file= loops before generateMetadata
 * opens Nostr pools. 404 (not 429) so crawlers drop the URL instead of retrying.
 */
export function middleware(request: NextRequest) {
  if (searchParamsHaveAbsurdRepoPath(request.nextUrl.searchParams)) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
