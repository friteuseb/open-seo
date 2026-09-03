# OpenSEO — notes d'install self-hosted (cyril-workstation)

Installé le 2026-08-28 dans `~/ddev/outils/open-seo` (clone de `every-app/open-seo`).

## État

- Conteneur : `open-seo-open-seo-1` (image `ghcr.io/every-app/open-seo:latest`)
- URL : http://127.0.0.1:3002 — **bind localhost uniquement** (3001 est pris par le Cockpit)
- Mode auth : `local_noauth` (utilisateur unique `admin@localhost`, aucune authentification)
- Endpoint MCP : `http://127.0.0.1:3002/mcp`
- Santé : `curl -s http://127.0.0.1:3002/api/health | jq`
- Données persistées dans le volume Docker `open-seo_open_seo_data`

## Reste à faire

1. Créer un compte DataForSEO : https://app.dataforseo.com/api-access
   ($1 de crédit offert, recharge minimum 50 $)
2. Copier la valeur « Base64 » du dashboard dans `.env` → `DATAFORSEO_API_KEY=`
3. Optionnel : `OPENROUTER_API_KEY=` pour activer SAM (l'agent SEO intégré)
4. Redémarrer : `docker compose up -d --force-recreate open-seo`

## Commandes

```bash
cd ~/ddev/outils/open-seo
docker compose up -d          # démarrer
docker compose down           # arrêter
docker compose logs -f        # logs
docker compose pull && docker compose up -d   # mettre à jour
```

## Sécurité

`AUTH_MODE=local_noauth` : aucune authentification. Ne jamais binder sur `0.0.0.0`
ni ouvrir le port 3002 dans UFW en l'état. Pour y accéder depuis le laptop :

```bash
ssh -L 3002:127.0.0.1:3002 workstation
```

Pour un accès réseau permanent, il faudrait soit un reverse proxy avec auth devant
(+ `ALLOWED_HOST` dans `.env`), soit passer au self-hosting Cloudflare Access
(cf. `docs/SELF_HOSTING_CLOUDFLARE.md`).

---

# Prod : atlas (openseo.seostrategy.fr)

L'instance de production tourne sur **atlas** (OVH, `hestia.coconweb.fr`), sans
Docker : service systemd `openseo`, checkout git dans `/var/www/openseo` sur la
branche `deploy/atlas`, `vite preview` lié à `127.0.0.1:3001`, nginx devant sur
l'IP Tailscale seule (`100.64.218.37`) — jamais joignable depuis l'IP publique,
puisque l'app est en `AUTH_MODE=local_noauth`.

- URL : https://openseo.seostrategy.fr (tailnet uniquement)
- Service : `/etc/systemd/system/openseo.service` → `/usr/local/bin/openseo-start.sh`
  (le script vit hors du dépôt pour ne jamais entrer en conflit avec un `git pull`)
- nginx : `/etc/nginx/sites-available/openseo`
- Santé : `ssh atlas 'curl -s http://127.0.0.1:3001/api/health'`

## Remotes git

`origin` = `git@github.com:friteuseb/open-seo.git` (le fork, où l'on pousse),
`upstream` = `https://github.com/every-app/open-seo.git` (l'amont, d'où l'on
tire `main` uniquement). La branche `main` suit `upstream`, `deploy/atlas` suit
`origin`.

## Livrer sur atlas

atlas ne tire pas depuis GitHub : le code arrive par un **git bundle** poussé en
SSH. Depuis le poste, une fois le commit fait sur `deploy/atlas` :

```bash
git push origin deploy/atlas
git bundle create /tmp/openseo-atlas.bundle <dernier-commit-sur-atlas>..deploy/atlas
scp /tmp/openseo-atlas.bundle atlas:/tmp/
ssh atlas '
  set -e
  cd /var/www/openseo
  git fetch /tmp/openseo-atlas.bundle deploy/atlas:refs/remotes/bundle/atlas
  git merge --ff-only refs/remotes/bundle/atlas
  # Indispensable : l empreinte du start script ne suit que les variables de
  # build, pas le code. Sans cette suppression, le service redemarre sur
  # l ancien dist et la livraison ne change rien.
  rm -f dist/.openseo-build-env
  sudo systemctl restart openseo
  rm -f /tmp/openseo-atlas.bundle
'
```

Le rebuild prend ~1 min ; attendre un `200` sur `/api/health` avant de conclure.
Le commit déjà en place sur atlas se lit avec
`ssh atlas 'cd /var/www/openseo && git log --oneline -1'`.
