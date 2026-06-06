# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Migration Discipline (NON-NEGOTIABLE)

- **NEVER** use `prisma db push` against any environment that has migration
  history. This caused production schema drift; see the corrective migrations
  `20260914000000_p0_compliance_prequal_index`,
  `20260914000001_p0_prequal_error_metadata`, and
  `20260914000002_p0_email_outcome_verification`.
- All schema changes require **both** a Prisma migration **and** idempotent SQL
  (`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS`). `ALTER TYPE ... ADD VALUE` must be
  a top-level statement — Postgres cannot run it inside a transaction block.
- Production deploys use `pnpm prisma migrate deploy` **only** — never
  `db push`.

### Pre-Deploy Checklist

Run from `frontend/` before merging a schema PR or deploying:

```
pnpm prisma generate
pnpm check:drift     # requires a reachable shadow Postgres — never point at prod
pnpm tsc --noEmit
pnpm lint
pnpm build
pnpm test
```

`pnpm check:drift` (`scripts/check-migration-drift.ts`) runs
`prisma migrate diff --from-migrations prisma/migrations
--to-schema-datamodel prisma/schema.prisma --exit-code` and fails if the
committed migrations do not reproduce `schema.prisma`. Wire it into CI with a
throwaway Postgres service once it has been confirmed green against a shadow DB
(it is intentionally not added to `ci.yml` as a hard gate until a shadow
database is provisioned there).

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
