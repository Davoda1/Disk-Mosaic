use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use std::io::{self, BufWriter, Write};
use std::sync::Arc;

#[derive(Clone)]
pub struct Emitter {
    out: Arc<Mutex<BufWriter<io::Stdout>>>,
}

impl Emitter {
    pub fn new() -> Self {
        Self {
            out: Arc::new(Mutex::new(BufWriter::new(io::stdout()))),
        }
    }

    pub fn emit<T: Serialize>(&self, event: &T) {
        match serde_json::to_string(event) {
            Ok(line) => {
                let mut out = self.out.lock();
                if writeln!(out, "{line}").is_ok() {
                    let _ = out.flush();
                }
            }
            Err(error) => eprintln!("protocol serialization error: {error}"),
        }
    }

    pub fn emit_value(&self, event: Value) {
        self.emit(&event);
    }
}
