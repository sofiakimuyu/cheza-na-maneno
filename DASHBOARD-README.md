# Private dashboard

This branch exists **only** to hold `dashboard.html`, and must never be merged
into `main`.

## Why it lives on its own branch

GitHub Pages serves this repo from `main` at the repository root, and the repo
is public. Any file on `main` is published at
`https://sofiakimuyu.github.io/cheza-na-maneno/`. Keeping the dashboard here
means it is never hosted.

To be precise about what that does and does not buy you:

- It does **not** protect the data. That is already enforced server-side — every
  `dash_*` function re-checks `is_admin()` in the database, so a hosted copy
  would still refuse non-admins. See `supabase/schema.sql` on `main`.
- It **does** keep a login form off the public internet, so there is nothing
  publicly reachable to brute-force and nothing advertising the admin surface.

`dashboard.html` is also listed in `.gitignore` on `main`, so a stray
`git add -A` there cannot publish it by accident.

## Running it

The dashboard is a static page that calls the Supabase API directly, so it needs
no hosting — just a local server (opening it as a `file://` URL will fail, since
the Supabase SDK needs a real origin).

From a checkout of `main`:

```sh
# restore the dashboard next to the game's other files (it is gitignored there)
git show private-dashboard:dashboard.html > dashboard.html

# serve the folder
npx -y serve -l 8934 .
```

Then open <http://localhost:8934/dashboard.html> and sign in with the admin
account you added to the `admins` table.

It depends on `vendor/supabase.js` and `supabase-config.js` being siblings —
both live on `main`, so this works from a normal checkout.

## Updating it

Edit on this branch and commit here. Do not cherry-pick it onto `main`.
