# Add the gittr tiles

On the phone, open [gittr.space/omalauncher](https://gittr.space/omalauncher) and tap **Add Nostr git** or **Add Nostr apps**. That opens the tile page. Tap **Open in Omalauncher** there.

Omalauncher shows the tile and asks before it keeps it. A tile already on the home screen keeps its old copy until you remove it and add it again. The gittr app opens that tile page in the phone's browser.

The tile files are [nostr-git.owl](nostr-git.owl) and [nostr-apps.owl](nostr-apps.owl).

## Widget store

Reviewed tiles are listed from [omarchy-widgets](https://github.com/SimonSchubert/omarchy-widgets), which is the store Omalauncher reads. They do not go in the Omalauncher app repo, and they are not an Omarchy desktop plugin.

To submit them, fork that repo and add:

- `widgets/<your-github-name>/nostr-git/widget.owl`
- `widgets/<your-github-name>/nostr-apps/widget.owl`

Copy the two `.owl` files above into those names. The folder name is your GitHub login in lowercase. Then, from a checkout of that repo:

```
java -jar tools/owl.jar review . widgets/<your-github-name>/nostr-git/widget.owl widgets/<your-github-name>/nostr-apps/widget.owl
```

Open the pull request. The phone buttons work before it is merged.
