//! Forge native engine, loaded from TypeScript with `bun:ffi` (C ABI).
//! Every function has a TypeScript fallback; the engine is an accelerator,
//! never a requirement.

mod hash;
mod router;

/// Bumped on any ABI change; checked by the TypeScript loader.
#[no_mangle]
pub extern "C" fn forge_abi_version() -> u32 {
    1
}

pub use hash::forge_hash_files;
pub use router::{forge_router_free, forge_router_match, forge_router_new};
