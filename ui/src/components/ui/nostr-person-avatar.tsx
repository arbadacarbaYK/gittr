import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  getEntityPicture,
  isDisplayableProfilePicture,
} from "@/lib/utils/entity-resolver";

/**
 * Picture for a person on an issue or pull request.
 * A real profile photo wins. A Nostr user with no photo gets the gittr mark.
 * A non-Nostr login (GitHub) keeps two letters from that login.
 */
export function NostrPersonAvatar({
  id,
  metadata,
  className,
  extraPicture,
}: {
  id: string;
  metadata?: Record<string, any>;
  className?: string;
  extraPicture?: string | null;
}) {
  const isNostr = /^[0-9a-f]{64}$/i.test(id || "");
  const fromProfile = isNostr ? getEntityPicture(id, metadata || {}) : null;
  const picture =
    fromProfile ||
    (isDisplayableProfilePicture(extraPicture) ? extraPicture : null);

  return (
    <Avatar className={className}>
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback className="bg-[#22262C] p-0 text-[10px] font-semibold text-white">
        {isNostr ? (
          <img
            src="/logo.svg"
            alt=""
            className="h-full w-full object-contain p-0.5"
          />
        ) : (
          (id || "?").slice(0, 2).toUpperCase()
        )}
      </AvatarFallback>
    </Avatar>
  );
}
