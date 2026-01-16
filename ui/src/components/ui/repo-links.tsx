"use client";

import {
  BookOpen,
  ExternalLink,
  Link as LinkIcon,
  MessageCircle,
  Youtube,
} from "lucide-react";
import {
  FileText,
  Github,
  Globe,
  MessageSquare, // Discord/Slack
  Twitter,
} from "lucide-react";

export interface RepoLink {
  type:
    | "docs"
    | "discord"
    | "slack"
    | "youtube"
    | "twitter"
    | "github"
    | "other";
  url: string;
  label?: string; // Optional custom label
}

interface RepoLinksProps {
  links?: RepoLink[];
}

// Icon mapping for different link types
const getLinkIcon = (type: RepoLink["type"]) => {
  switch (type) {
    case "docs":
      return BookOpen;
    case "discord":
      return MessageSquare;
    case "slack":
      return MessageSquare;
    case "youtube":
      return Youtube;
    case "twitter":
      return Twitter;
    case "github":
      return Github;
    case "other":
      return LinkIcon;
    default:
      return Globe;
  }
};

// Get display label for link type
const getLinkLabel = (link: RepoLink) => {
  if (link.label) return link.label;

  switch (link.type) {
    case "docs":
      return "Documentation";
    case "discord":
      return "Discord";
    case "slack":
      return "Slack";
    case "youtube":
      return "YouTube";
    case "twitter":
      return "Twitter";
    case "github":
      return "GitHub";
    case "other":
      return "Link";
    default:
      return "Link";
  }
};

// Group links by type
const groupLinksByType = (links: RepoLink[]) => {
  const grouped: Record<string, RepoLink[]> = {};
  links.forEach((link) => {
    if (!grouped[link.type]) {
      grouped[link.type] = [];
    }
    const typeArray = grouped[link.type];
    if (typeArray) {
      typeArray.push(link);
    }
  });
  return grouped;
};

export function RepoLinks({ links = [] }: RepoLinksProps) {
  if (!links || links.length === 0) {
    return null;
  }

  const grouped = groupLinksByType(links);
  const types = Object.keys(grouped) as RepoLink["type"][];

  return (
    <div className="mt-4 space-y-3">
      <h3 className="font-bold text-sm">Links</h3>
      <div className="space-y-2">
        {types.map((type) => {
          const typeLinks = grouped[type];
          if (!typeLinks || typeLinks.length === 0) return null;

          const Icon = getLinkIcon(type);

          return (
            <div key={type} className="space-y-1">
              {typeLinks.map((link, idx) => (
                <a
                  key={idx}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-gray-400 hover:text-purple-400 transition-colors group"
                  title={link.url}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate flex-1">{getLinkLabel(link)}</span>
                  {typeLinks.length > 1 && (
                    <span className="text-xs text-gray-500">#{idx + 1}</span>
                  )}
                  <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
