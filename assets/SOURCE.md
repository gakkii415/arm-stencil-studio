# Model sources and processing

All ten models use the adult realistic male or female assets by Dan Ulrich from Blender Studio's Human Base Meshes v1.4.1 bundle. The official distribution and its asset collections state **CC0 1.0 Universal**.

- Official information and license: https://www.blender.org/download/demo-files/
- Bundle: https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip
- License text: https://creativecommons.org/publicdomain/zero/1.0/
- Original objects: `GEO-body_male_realistic` and `GEO-body_female_realistic`, evaluated at Multiresolution level 2.

The original scan surface is preserved. Processing consists of extracting the requested body region, rigid rotation/translation, uniform scaling, closing extraction openings with context caps, and subdividing triangles at paint and UV boundaries. No cylindrical reconstruction or resculpting changes the anatomy. Small hand/foot scan wrinkles whose smoothed shading normals disagree with their face winding receive local face normals without moving vertices.

| Selection | Reference drawing extent | Display context |
| --- | --- | --- |
| Male/female right and left arms | Shoulder to wrist, 540 mm; elbow at the source landmark | Hand, fingers, shoulder opening cap |
| Male/female right and left legs | Hip to ankle, 800 mm; knee at the source landmark | Foot, toes, hip opening cap |
| Male/female back with shoulders | Shoulder-level torso to lower back, 500 mm; both posterior deltoids are drawable | Front torso, lower neck, extraction caps |

Both sides come from their respective original scan surfaces. Left arms and legs are not synthetic reflections of the right models. Right arm extraction uses upper-arm/forearm sets 20/11 and hand base 10; left uses 21/12 and hand base 9. Right leg extraction uses thigh/lower-leg sets 23/16 and foot base 13; left uses 24/15 and foot base 14. Original fingers and toes remain display context. The tilted wrist/ankle borders are clipped at their horizontal reference limits: joint faces above those limits are drawable, while the hand/foot below remains context.

The shoulder-inclusive torso retains body sets 1, 18 and 19 plus both upper-arm roots 20 and 21. The original rounded deltoids and short upper-arm stumps remain intact; their posterior surfaces are drawable. Lower-neck set 17 connects the torso to a level neck cut and stays context. Chest, abdomen and every internal extraction cap are context. Individual forward-facing facets of posterior quads also remain context, keeping the planar drawing projection free of folded UV triangles.

Wrap models use actual horizontal mesh intersection contours and their cumulative surface distance for UVs. Inner seams have duplicated u=0/1 edges, and crossing triangles are subdivided. The inner seam is negative X for right limbs and positive X for left limbs in the application frame. Reference stencil widths come from measured contour circumferences every 5 mm. Back UVs and the single shoulder-inclusive back stencil use a posterior planar projection and the projected drawable width. Texture v is 1 at the top and 0 at the bottom.

`right-arm.glb` retains the existing male-arm model. Additional assets are produced by `scripts/build-model-asset.py` from the extracted vertical Blender files and their landmark metadata. GLBs record source provenance; generated profiles also record scale, source vertex preservation, geometry statistics and shoulder landmarks.

These dimensions describe the scaled reference models. They are neither population averages nor measurements of the person applying the stencil. Wrap and back sheets are approximate and require a paper fitting before transfer.
