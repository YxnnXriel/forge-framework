//! Segment-tree router (same semantics as packages/web/src/shared/match.ts):
//! static segments are tried before the param branch, with backtracking.

use std::collections::HashMap;

struct Node {
    statics: HashMap<Box<[u8]>, usize>,
    param: Option<usize>,
    route: i32,
}

impl Node {
    fn new() -> Self {
        Node { statics: HashMap::new(), param: None, route: -1 }
    }
}

pub struct Router {
    nodes: Vec<Node>,
}

impl Router {
    fn child(&mut self, at: usize, seg: &[u8]) -> usize {
        if seg.first() == Some(&b'[') {
            if let Some(n) = self.nodes[at].param {
                return n;
            }
            self.nodes.push(Node::new());
            let n = self.nodes.len() - 1;
            self.nodes[at].param = Some(n);
            n
        } else {
            if let Some(&n) = self.nodes[at].statics.get(seg) {
                return n;
            }
            self.nodes.push(Node::new());
            let n = self.nodes.len() - 1;
            self.nodes[at].statics.insert(seg.into(), n);
            n
        }
    }

    fn walk(&self, n: usize, segs: &[(u32, u32)], path: &[u8], i: usize, out: &mut Vec<(u32, u32)>) -> i32 {
        if i == segs.len() {
            return self.nodes[n].route;
        }
        let (s, e) = segs[i];
        if let Some(&next) = self.nodes[n].statics.get(&path[s as usize..e as usize]) {
            let r = self.walk(next, segs, path, i + 1, out);
            if r >= 0 {
                return r;
            }
        }
        if let Some(p) = self.nodes[n].param {
            out.push((s, e));
            let r = self.walk(p, segs, path, i + 1, out);
            if r >= 0 {
                return r;
            }
            out.pop();
        }
        -1
    }
}

/// `patterns`: route ids (`/posts/[id]`) separated by `\n`, in priority order.
/// The route index is the line index.
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn forge_router_new(ptr: *const u8, len: usize) -> *mut Router {
    let data = std::slice::from_raw_parts(ptr, len);
    let mut router = Router { nodes: vec![Node::new()] };
    for (id, line) in data.split(|&b| b == b'\n').enumerate() {
        let mut at = 0;
        for seg in line.split(|&b| b == b'/').filter(|s| !s.is_empty()) {
            at = router.child(at, seg);
        }
        if router.nodes[at].route < 0 {
            router.nodes[at].route = id as i32;
        }
    }
    Box::into_raw(Box::new(router))
}

/// Matches a (still percent-encoded) path. Writes up to `max_params` param
/// spans as `[start, end]` u32 pairs into `out`; returns the route index or -1.
///
/// # Safety
/// `router` comes from `forge_router_new`; `ptr`/`len` readable; `out` has room
/// for `2 * max_params` u32.
#[no_mangle]
pub unsafe extern "C" fn forge_router_match(
    router: *const Router,
    ptr: *const u8,
    len: usize,
    out: *mut u32,
    max_params: u32,
) -> i32 {
    let router = &*router;
    let path = std::slice::from_raw_parts(ptr, len);
    let mut segs: Vec<(u32, u32)> = Vec::with_capacity(8);
    let mut start = 0usize;
    for (i, &b) in path.iter().enumerate() {
        if b == b'/' {
            if i > start {
                segs.push((start as u32, i as u32));
            }
            start = i + 1;
        }
    }
    if len > start {
        segs.push((start as u32, len as u32));
    }
    let mut params = Vec::with_capacity(4);
    let id = router.walk(0, &segs, path, 0, &mut params);
    if id >= 0 && params.len() as u32 <= max_params {
        for (k, (s, e)) in params.iter().enumerate() {
            *out.add(k * 2) = *s;
            *out.add(k * 2 + 1) = *e;
        }
    }
    id
}

/// # Safety
/// `router` comes from `forge_router_new` and is not used afterwards.
#[no_mangle]
pub unsafe extern "C" fn forge_router_free(router: *mut Router) {
    if !router.is_null() {
        drop(Box::from_raw(router));
    }
}
