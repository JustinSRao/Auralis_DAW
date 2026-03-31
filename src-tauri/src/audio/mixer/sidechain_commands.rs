//! Tauri commands for sidechain routing configuration (Sprint 39).
//!
//! These commands run on the control thread and update:
//! 1. The `SidechainRouter` — authoritative routing map.
//! 2. The `MixerChannel` — wires/removes the `Arc<SidechainTap>` so the audio
//!    thread writes to it each callback.
//! 3. The `EffectChain` / `Compressor` — injects or removes the tap reference
//!    so the compressor reads from the correct source.

use std::sync::{Arc, Mutex};
use tauri::State;

use super::sidechain::SidechainRouterStore;
use crate::audio::mixer::commands::MixerState;
use crate::audio::effect_chain::ChainStore;

/// Wires `source_channel_id` as the sidechain source for the compressor at
/// `(dest_channel_id, slot_id)` in the destination channel's effect chain.
///
/// Allocates a `SidechainTap` for `source_channel_id` (once; shared on
/// subsequent calls), wires it into the source `MixerChannel`, and injects
/// it into the destination `Compressor` via `AudioEffect::set_sidechain`.
///
/// Returns an error string if the routing would create a cycle.
#[tauri::command]
pub fn set_sidechain_source(
    dest_channel_id: String,
    slot_id:         String,
    source_channel_id: String,
    hpf_cutoff_hz:   f32,
    hpf_enabled:     bool,
    router_store:    State<'_, SidechainRouterStore>,
    mixer_state:     State<'_, MixerState>,
    chain_store:     State<'_, ChainStore>,
) -> Result<(), String> {
    // 1. Register route + get (or create) the tap.
    let tap = {
        let mut router = router_store.lock()
            .map_err(|e| format!("Router lock: {e}"))?;
        router.set_route(
            dest_channel_id.clone(),
            slot_id.clone(),
            source_channel_id.clone(),
            hpf_cutoff_hz,
            hpf_enabled,
        )?
    };

    // 2. Attach the tap to the source MixerChannel so it writes post-fader audio.
    {
        let mut mixer = mixer_state.lock()
            .map_err(|e| format!("Mixer lock: {e}"))?;
        if let Some(ch) = mixer.channels.iter_mut().find(|c| c.id == source_channel_id) {
            ch.sidechain_tap = Some(Arc::clone(&tap));
        }
        // If channel not found we still proceed — tap is registered for when it is added.
    }

    // 3. Inject tap + HPF settings into the Compressor effect slot.
    {
        let mut chains = chain_store.lock()
            .map_err(|e| format!("Chain store lock: {e}"))?;
        if let Some(chain) = chains.get_mut(&dest_channel_id) {
            if let Some(slot) = chain.slots.iter_mut().find(|s| s.slot_id == slot_id) {
                slot.effect.set_sidechain(Some(Arc::clone(&tap)));
                slot.effect.set_sidechain_hpf(hpf_cutoff_hz, hpf_enabled);
            }
        }
    }

    Ok(())
}

/// Removes the sidechain connection for the compressor at `(dest_channel_id, slot_id)`.
///
/// Reverts the compressor to self-detection.  If no other compressor still
/// uses the source channel's tap, the `MixerChannel.sidechain_tap` is also
/// cleared so the audio thread stops writing the tap.
#[tauri::command]
pub fn remove_sidechain(
    dest_channel_id: String,
    slot_id:         String,
    router_store:    State<'_, SidechainRouterStore>,
    mixer_state:     State<'_, MixerState>,
    chain_store:     State<'_, ChainStore>,
) -> Result<(), String> {
    // Find the source channel before removing the route.
    let maybe_source = {
        let router = router_store.lock()
            .map_err(|e| format!("Router lock: {e}"))?;
        router.get_entry(&dest_channel_id, &slot_id)
            .map(|e| e.source_channel_id.clone())
    };

    // Remove the route from the registry.
    {
        let mut router = router_store.lock()
            .map_err(|e| format!("Router lock: {e}"))?;
        router.remove_route(&dest_channel_id, &slot_id);
    }

    // Disconnect the compressor from the tap.
    {
        let mut chains = chain_store.lock()
            .map_err(|e| format!("Chain store lock: {e}"))?;
        if let Some(chain) = chains.get_mut(&dest_channel_id) {
            if let Some(slot) = chain.slots.iter_mut().find(|s| s.slot_id == slot_id) {
                slot.effect.set_sidechain(None);
            }
        }
    }

    // If no other route still uses this source channel's tap, clear the channel tap.
    if let Some(src_id) = maybe_source {
        let still_used = {
            let router = router_store.lock()
                .map_err(|e| format!("Router lock: {e}"))?;
            router.all_entries().iter()
                .any(|(_, e)| e.source_channel_id == src_id)
        };
        if !still_used {
            let mut mixer = mixer_state.lock()
                .map_err(|e| format!("Mixer lock: {e}"))?;
            if let Some(ch) = mixer.channels.iter_mut().find(|c| c.id == src_id) {
                ch.sidechain_tap = None;
            }
        }
    }

    Ok(())
}

/// Updates the high-pass filter cutoff and enable state for an existing sidechain route.
#[tauri::command]
pub fn set_sidechain_filter(
    dest_channel_id: String,
    slot_id:         String,
    cutoff_hz:       f32,
    enabled:         bool,
    router_store:    State<'_, SidechainRouterStore>,
    chain_store:     State<'_, ChainStore>,
) -> Result<(), String> {
    // Update the router's persisted filter settings.
    {
        let mut router = router_store.lock()
            .map_err(|e| format!("Router lock: {e}"))?;
        router.set_filter(&dest_channel_id, &slot_id, cutoff_hz, enabled)?;
    }

    // Push the new coefficients into the compressor.
    {
        let mut chains = chain_store.lock()
            .map_err(|e| format!("Chain store lock: {e}"))?;
        if let Some(chain) = chains.get_mut(&dest_channel_id) {
            if let Some(slot) = chain.slots.iter_mut().find(|s| s.slot_id == slot_id) {
                slot.effect.set_sidechain_hpf(cutoff_hz, enabled);
            }
        }
    }

    Ok(())
}
