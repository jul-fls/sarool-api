# sarool-ics

**Serveur Node.js exposant un planning Sarool au format `.ics` (calendrier)**
Authentification automatique, cache intelligent, anti-stampede, et **configuration générique des établissements via variables d’environnement**.

👉 Compatible avec **toutes les auto-écoles utilisant Sarool**, sans dépendance à une structure interne spécifique.

👉 **Docker-ready** : image construite et publiée automatiquement via CI/CD.

## ✨ Fonctionnalités

* 🔐 **Connexion automatique à Sarool** (WebForms, cookies persistants)
* 📅 Extraction du **planning personnel**
* 🗓️ Génération d’un **fichier ICS** compatible Google Calendar / Apple Calendar / Outlook
* 🧠 **Cache mémoire avec TTL**
* 🚦 Protection contre les **requêtes concurrentes** (anti cache-stampede)
* ⏱️ **Logs de performance détaillés** (auth, parsing, génération ICS)
* 🏫 **Mapping des lieux configurable par type d’événement** (`lecon`, `module`, `simulateur`)
* 🔑 Accès sécurisé via **token d’API**
* ⚙️ Configuration **100 % via variables d’environnement**
* 🐳 **Exécutable via Docker / Docker Compose**

## 📦 Prérequis

* **Node.js 18+** (ou Docker)
* Un **compte Sarool valide**
* Accès réseau sortant vers `www.sarool.fr`
* Un client calendrier compatible ICS (Google / Apple / Outlook…)

## 🔧 Installation (Node.js)

```bash
git clone https://github.com/jul-fls/sarool-ics.git
cd sarool-ics
npm install
cp .env.example .env
```

👉 **Toutes les variables d’exemple sont fournies dans `.env.example`**.

## ⚙️ Variables d’environnement

### 🔐 Obligatoires

```ini
SAROOL_EMAIL=prenom.nom@email.com
SAROOL_PASSWORD=mot_de_passe_sarool
API_TOKEN=token_secret_pour_l_api
TZ=Europe/Paris
```

### ⏱️ Cache (optionnel)

```ini
CACHE_TTL_SECONDS=60
```

> Durée de validité du cache ICS (en secondes).
> Par défaut : `60`.

### 🏫 Configuration des établissements (IMPORTANT)

Sarool **ne fournit pas explicitement les informations d’établissement** dans le planning HTML.
Ce projet utilise donc un **mapping configurable par type d’événement**, défini par variables d’environnement.

#### Lieu par défaut (fallback)

```ini
DEFAULT_LOCATION_NAME=Auto-école principale
DEFAULT_LOCATION_ADDRESS=xx nom de rue, CP ville
```

#### Leçons de conduite

```ini
LECON_LOCATION_NAME=Agence centre-ville
LECON_LOCATION_ADDRESS=xx nom de rue, CP ville
```

#### Modules (code, premiers secours, etc.)

```ini
MODULE_LOCATION_NAME=Centre de formation
MODULE_LOCATION_ADDRESS=xx nom de rue, CP ville
```

#### Simulateur

```ini
SIMULATEUR_LOCATION_NAME=Pôle simulateur
SIMULATEUR_LOCATION_ADDRESS=xx nom de rue, CP ville
```

👉 Si un type n’est **pas défini**, le **lieu par défaut** est utilisé automatiquement.

## ▶️ Démarrage (Node.js)

```bash
node server.js
```

Logs attendus :

```text
Serveur prêt → http://localhost:3000/planning?token=XXXX
```

## 🌐 Utilisation

### Récupérer le calendrier ICS

```text
http://localhost:3000/planning?token=VOTRE_TOKEN
```

➡️ Le navigateur téléchargera automatiquement :

```
sarool-planning.ics
```

Tu peux ensuite :

* l’importer dans ton calendrier
* ou t’y **abonner** pour un rafraîchissement automatique

## ⏱️ Performances (exemple réel)

```text
[REQUEST] /planning started
[AUTH] OK (193 ms)
[PLANNING] 25 événements (209 ms)
[ICS] généré en 33 ms
[TIMING] TOTAL /planning: 436 ms
```

Avec cache :

```text
[CACHE] HIT
[TIMING] TOTAL (cache): 1 ms
```

## 🐳 Utilisation avec Docker

### Image officielle (CI/CD)

L’image Docker est construite et publiée automatiquement à chaque mise à jour :

```text
ghcr.io/jul-fls/sarool-api/app:latest
```

### ▶️ Lancer avec Docker

```bash
docker run -d \
  --name sarool-ics \
  -p 3000:3000 \
  --env-file .env \
  ghcr.io/jul-fls/sarool-api/app:latest
```

## 🐳 Docker Compose (recommandé)

### Commandes

```bash
# Démarrer
docker compose up -d

# Voir les logs
docker compose logs -f

# Mettre à jour l'image
docker compose pull
docker compose up -d

# Arrêter
docker compose down
```

## 🧠 Comment ça marche

1. L’API reçoit une requête `/planning`
2. Vérification du **token**
3. Si cache valide → réponse immédiate
4. Sinon :

   * Connexion Sarool (si nécessaire)
   * Récupération du planning HTML
   * Parsing des événements
   * Détection du type (`lecon`, `module`, `simulateur`)
   * Résolution du lieu via les variables d’environnement
   * Génération du fichier `.ics`
5. Mise en cache + réponse

➡️ Une seule requête Sarool est effectuée même en cas d’appels simultanés.

## 🚦 Sécurité & limites

* 🔑 **Token obligatoire** pour éviter l’exposition publique
* 🧠 Cache en mémoire (non persistant)
* 🔄 Redémarrage = nouveau login Sarool
* ❌ Pas d’API officielle Sarool → parsing HTML (structure susceptible d’évoluer)

## 🛠️ Dépannage

### ❌ `Unauthorized`

→ Token manquant ou invalide dans l’URL

### ❌ `AUTH FAILED`

→ Identifiants Sarool incorrects ou changement de la page de login

### 📭 Planning vide

→ Aucun événement ou structure HTML modifiée côté Sarool

### 🔁 Trop de requêtes

→ Augmenter `CACHE_TTL_SECONDS`

## 🗺️ Roadmap (idées)

* Cache disque (persistant)
* Support multi-comptes Sarool
* Mapping avancé par mot-clé ou moniteur
* Génération ICS séparée par type (`/planning/module.ics`)
* Mode lecture seule sans mot de passe (proxy)

## ⚠️ Avertissement

Ce projet **n’est pas affilié à Sarool**.
Il repose sur l’analyse du HTML public après authentification et peut cesser de fonctionner si Sarool modifie son interface.