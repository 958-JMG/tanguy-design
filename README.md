# Tanguy Design — Cockpit

Cockpit de gestion chantiers cuisines pour l'agence Tanguy Design (Vannes).
4 utilisateurs : Virginie (admin), Solène (design), Sébastien (pose), Marine (commercial).

## Stack
Node.js 18+ / Express 4.19 / Airtable / session cookie + bcrypt / Railway

## Local
```bash
cp .env.example .env   # remplir SESSION_SECRET, AIRTABLE_*, USERS_HASHES
npm install
npm start
```

Health: `curl http://localhost:3000/api/health`

## Hash d'un mot de passe
```bash
node scripts/hash-password.js MonMotDePasse
```

## Tables Airtable
Clients · Projets · Artisans · Fournisseurs · Commandes · Tâches · SAV
