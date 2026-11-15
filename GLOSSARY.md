# ViMu

ViMu lets people discover Valuables at real-world sites in the collector app, acquire them, and use what they own in the ViMu game.

## Language

### Catalogue

**Valuable**:
A real-world artefact or sight, published by a Provider, that people can discover and acquire.
_Avoid_: item, object

**Provider**:
The organisation or person a Valuable comes from and who publishes it.
_Avoid_: publisher, partner

### Scans

**Scan**:
The 3D capture of a Valuable, usually made by photogrammetry; hand-modelled for DIGITAL and VIRTUAL Valuables. Every Valuable except AUDIO and MOVIE has exactly one.
_Avoid_: object, model, 3D object, mesh

**Rendition**:
One file of a Scan made for a specific use: Source, Game asset, Preview or Poster.
_Avoid_: version, variant, LOD

**Source**:
The raw export from the photogrammetry tool, kept only so the Scan can be re-processed; never handed out.
_Avoid_: original, master, raw scan

**Game asset**:
The high-resolution Rendition used in the game; only Owners can download it.
_Avoid_: high-res model, master, download

**Preview**:
The lightweight Rendition shown in the collector app, light enough to render on common phones.
_Avoid_: thumbnail, low-poly, preview model

**Poster**:
A still image of a Scan, shown wherever the Preview isn't rendered, such as lists and cards.
_Avoid_: thumbnail, cover

### Ownership

**UserValuable**:
The record of one user getting one Valuable: either an acquisition, with the price paid and the payment status, or a Grant.
_Avoid_: purchase, order, collection entry

**Grant**:
A free UserValuable given to the Provider of a Valuable, so the Provider owns its own Valuable. It never counts as an acquisition.
_Avoid_: gift, free copy, provider copy

**Owner**:
A user with a completed UserValuable for a Valuable. Free Valuables are owned as soon as they are acquired; Providers own their own Valuables through a Grant.
_Avoid_: buyer, holder
