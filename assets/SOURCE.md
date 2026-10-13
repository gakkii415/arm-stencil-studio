# Model sources and processing

All six models use the adult realistic male or female assets by Dan Ulrich from Blender Studio's Human Base Meshes v1.4.1 bundle. The official distribution and its asset collections state **CC0 1.0 Universal**.

- Official information and license: https://www.blender.org/download/demo-files/
- Bundle: https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip
- License text: https://creativecommons.org/publicdomain/zero/1.0/
- Original objects: `GEO-body_male_realistic` and `GEO-body_female_realistic`, evaluated at Multiresolution level 2.

The original scan surface is preserved. Processing consists of extracting the requested body region, rigid rotation/translation, uniform scaling, closing extraction openings with context caps, and subdividing triangles at paint and UV boundaries. No cylindrical reconstruction or resculpting changes the anatomy. Small hand/foot scan wrinkles whose smoothed shading normals disagree with their face winding receive local face normals without moving vertices.

| Selection | Reference drawing extent | Display context |
| --- | --- | --- |
| Male/female right arm | Shoulder to wrist, 540 mm; elbow at the source landmark | Hand, fingers, shoulder opening cap |
| Male/female right leg | Hip to ankle, 800 mm; knee at the source landmark | Foot, toes, hip opening cap |
| Male/female back | Upper back to lower back, 500 mm | Front torso and extraction caps |

Arm extraction uses original sculpt face sets 20, 11, 10 and 84–103. Leg extraction uses sets 23, 16, 13 and 26–45. The tilted wrist/ankle borders are clipped at their horizontal reference limits: joint faces above those limits are drawable, while the hand/foot below remains context. Back extraction retains torso sets 1, 18 and 19, with the posterior surface separately marked drawable; the chest and abdomen remain context.

Wrap models use actual horizontal mesh intersection contours and their cumulative surface distance for UVs. Inner seams have duplicated u=0/1 edges, and crossing triangles are subdivided. Their reference stencil widths come from measured contour circumferences every 5 mm. Back UVs and the single back stencil use a posterior planar projection and the projected source width. Texture v is 1 at the top and 0 at the bottom.

`right-arm.glb` retains the existing male-arm model. Additional assets are produced by `scripts/build-model-asset.py` from the extracted vertical Blender files and their landmark metadata. Each GLB and generated profile records its source, author, license, scale and geometry statistics.

These dimensions describe the scaled reference models. They are neither population averages nor measurements of the person applying the stencil. Wrap and back sheets are approximate and require a paper fitting before transfer.
