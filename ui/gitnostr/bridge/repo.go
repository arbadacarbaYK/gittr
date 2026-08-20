package bridge

import "strings"

func IsValidRepoName(repoName string) bool {
	return len(repoName) > 0 &&
		!strings.Contains(repoName, "..") &&
		!strings.ContainsAny(repoName, " /\\")
}
