# @modelshelf/model-contracts

Generated TypeScript types and boundary validators for the shared model contract
(`schemas/model/v1`). See `docs/adr/0001-reusable-model-modules.md` and
`schemas/model/v1/README.md` for what this exists to do and its versioning rules.

No app, Next.js, React, or Three.js imports — a future browser viewer or worker
consumer imports this package, not the other way around.

```sh
npm install --prefix packages/model-contracts-ts
npm run generate --prefix packages/model-contracts-ts   # regenerate src/generated/*.ts
npm run build --prefix packages/model-contracts-ts       # tsc -> dist/
npm test --prefix packages/model-contracts-ts             # runs against schemas/model/v1/fixtures
```

`src/generated/*.ts` is generated (do not hand-edit); `src/validate.ts` compiles
Ajv validators from the same canonical schema files at runtime, so there is exactly
one source of truth for the wire shape. `src/express-id-mapping.ts` implements the
IFC express-ID -> `ObjectRef.objectId` mapping documented in
`schemas/model/v1/README.md`.
