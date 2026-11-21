import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const IFC_GUID_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

function makeDeterministicIfcGuid(seedIndex) {
  let num = BigInt(seedIndex + 1000003) * 2654435761n;
  let out = '2'; // Valid IFC GlobalId leading char (0-3)
  for (let i = 1; i < 22; i++) {
    num = (num * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    const idx = Number((num >> 56n) % 64n);
    out += IFC_GUID_CHARS[idx];
  }
  return out;
}

class IfcBuilder {
  constructor() {
    this.lines = [];
    this.nextId = 1;
    this.guidCounter = 1;
    this.styles = new Map();
    this.containedProducts = [];
  }

  add(entityStr) {
    const id = this.nextId++;
    this.lines.push(`#${id}=${entityStr};`);
    return `#${id}`;
  }

  guid() {
    return makeDeterministicIfcGuid(this.guidCounter++);
  }

  num(v) {
    const rounded = Math.abs(v) < 1e-6 ? 0 : Number(v.toFixed(4));
    return Number.isInteger(rounded) ? `${rounded}.` : `${rounded}`;
  }

  getOrCreateStyle(name, r, g, b, transparency = 0) {
    const key = `${name}:${r}:${g}:${b}:${transparency}`;
    if (this.styles.has(key)) return this.styles.get(key);
    const col = this.add(
      `IFCCOLOURRGB($,${this.num(r)},${this.num(g)},${this.num(b)})`
    );
    const ren = this.add(
      `IFCSURFACESTYLERENDERING(${col},${this.num(transparency)},$,$,$,$,$,$,.NOTDEFINED.)`
    );
    const surf = this.add(`IFCSURFACESTYLE('${name}',.BOTH.,(${ren}))`);
    const assign = this.add(`IFCPRESENTATIONSTYLEASSIGNMENT((${surf}))`);
    this.styles.set(key, assign);
    return assign;
  }

  initBase() {
    const person = this.add(`IFCPERSON($,$,'Builder',$,$,$,$,$)`);
    const org = this.add(`IFCORGANIZATION($,'ClashFlight',$,$,$)`);
    const po = this.add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
    const app = this.add(
      `IFCAPPLICATION(${org},'0.1','ClashFlight Sample','ClashFlight')`
    );
    this.ownerHistory = this.add(
      `IFCOWNERHISTORY(${po},${app},$,.ADDED.,$,$,$,0)`
    );

    const lenUnit = this.add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
    const areaUnit = this.add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
    const volUnit = this.add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
    const unitAssign = this.add(
      `IFCUNITASSIGNMENT((${lenUnit},${areaUnit},${volUnit}))`
    );

    this.dirX = this.add(`IFCDIRECTION((1.,0.,0.))`);
    this.dirY = this.add(`IFCDIRECTION((0.,1.,0.))`);
    this.dirZ = this.add(`IFCDIRECTION((0.,0.,1.))`);
    this.origin3D = this.add(`IFCCARTESIANPOINT((0.,0.,0.))`);
    this.axis3D = this.add(
      `IFCAXIS2PLACEMENT3D(${this.origin3D},${this.dirZ},${this.dirX})`
    );

    const pt2d = this.add(`IFCCARTESIANPOINT((0.,0.))`);
    const dir2d = this.add(`IFCDIRECTION((1.,0.))`);
    this.axis2D = this.add(`IFCAXIS2PLACEMENT2D(${pt2d},${dir2d})`);

    const ctx = this.add(
      `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${this.axis3D},$)`
    );
    this.bodySubCtx = this.add(
      `IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`
    );

    const project = this.add(
      `IFCPROJECT('${this.guid()}',${this.ownerHistory},'ClashFlight Coordination Hall',$,$,$,$,(${ctx}),${unitAssign})`
    );

    this.rootPlacement = this.add(`IFCLOCALPLACEMENT($,${this.axis3D})`);
    const site = this.add(
      `IFCSITE('${this.guid()}',${this.ownerHistory},'Sample Site',$,$,${this.rootPlacement},$,$,.ELEMENT.,$,$,$,$,$)`
    );
    this.add(
      `IFCRELAGGREGATES('${this.guid()}',${this.ownerHistory},$,$,${project},(${site}))`
    );

    const building = this.add(
      `IFCBUILDING('${this.guid()}',${this.ownerHistory},'Coordination Hall',$,$,${this.rootPlacement},$,$,.ELEMENT.,$,$,$)`
    );
    this.add(
      `IFCRELAGGREGATES('${this.guid()}',${this.ownerHistory},$,$,${site},(${building}))`
    );

    this.storey = this.add(
      `IFCBUILDINGSTOREY('${this.guid()}',${this.ownerHistory},'Level 01',$,$,${this.rootPlacement},$,$,.ELEMENT.,0.)`
    );
    this.add(
      `IFCRELAGGREGATES('${this.guid()}',${this.ownerHistory},$,$,${building},(${this.storey}))`
    );
  }

  /**
   * Adds an extruded box IFC product spanning [minX..maxX, minY..maxY, minZ..maxZ].
   */
  addBoxProduct({
    ifcClass,
    name,
    min,
    max,
    color,
    extraTail = '',
    transparency = 0,
  }) {
    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    const cx = (min[0] + max[0]) * 0.5;
    const cy = (min[1] + max[1]) * 0.5;
    const baseZ = min[2];

    const pt = this.add(
      `IFCCARTESIANPOINT((${this.num(cx)},${this.num(cy)},${this.num(baseZ)}))`
    );
    const axis = this.add(
      `IFCAXIS2PLACEMENT3D(${pt},${this.dirZ},${this.dirX})`
    );
    const placement = this.add(
      `IFCLOCALPLACEMENT(${this.rootPlacement},${axis})`
    );

    const profile = this.add(
      `IFCRECTANGLEPROFILEDEF(.AREA.,$,${this.axis2D},${this.num(dx)},${this.num(dy)})`
    );
    const solid = this.add(
      `IFCEXTRUDEDAREASOLID(${profile},${this.axis3D},${this.dirZ},${this.num(dz)})`
    );

    const styleAssign = this.getOrCreateStyle(
      name,
      color[0],
      color[1],
      color[2],
      transparency
    );
    this.add(`IFCSTYLEDITEM(${solid},(${styleAssign}),$)`);

    const shapeRep = this.add(
      `IFCSHAPEREPRESENTATION(${this.bodySubCtx},'Body','SweptSolid',(${solid}))`
    );
    const prodShape = this.add(
      `IFCPRODUCTDEFINITIONSHAPE($,$,(${shapeRep}))`
    );

    const guid = this.guid();
    const product = this.add(
      `${ifcClass}('${guid}',${this.ownerHistory},'${name}',$,$,${placement},${prodShape},'${name}'${extraTail})`
    );
    this.containedProducts.push(product);
    return { guid, product, min, max, name, ifcClass };
  }

  buildString() {
    if (this.containedProducts.length > 0) {
      this.add(
        `IFCRELCONTAINEDINSPATIALSTRUCTURE('${this.guid()}',${this.ownerHistory},$,$,(${this.containedProducts.join(',')}),${this.storey})`
      );
    }

    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
      "FILE_NAME('clashflight-sample.ifc','2026-11-22T00:00:00',('ClashFlight'),('ClashFlight'),'IFC2X3','ClashFlight Sample Generator','');",
      "FILE_SCHEMA(('IFC2X3'));",
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}

function buildSampleModelAndBcf() {
  const ifc = new IfcBuilder();
  ifc.initBase();

  const SLAB_COLOR = [0.68, 0.72, 0.76];
  const WALL_COLOR = [0.88, 0.87, 0.83];
  const PARTITION_COLOR = [0.76, 0.79, 0.84];
  const STEEL_COLOR = [0.24, 0.42, 0.62];
  const DUCT_COLOR = [0.18, 0.66, 0.78];
  const PIPE_COLOR = [0.85, 0.45, 0.18];
  const FIRE_COLOR = [0.82, 0.2, 0.22];

  // Ground floor slab
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Ground Slab S-01',
    min: [-12, -8, 0],
    max: [12, 8, 0.3],
    color: SLAB_COLOR,
    extraTail: ',.FLOOR.',
  });

  // Level 2 Mezzanine Slab around 10x8m central atrium
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Level 2 Slab West',
    min: [-12, -8, 3.6],
    max: [-5, 8, 3.9],
    color: SLAB_COLOR,
    extraTail: ',.FLOOR.',
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Level 2 Slab East',
    min: [5, -8, 3.6],
    max: [12, 8, 3.9],
    color: SLAB_COLOR,
    extraTail: ',.FLOOR.',
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Level 2 Slab South',
    min: [-5, -8, 3.6],
    max: [5, -4, 3.9],
    color: SLAB_COLOR,
    extraTail: ',.FLOOR.',
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Level 2 Slab North',
    min: [-5, 4, 3.6],
    max: [5, 8, 3.9],
    color: SLAB_COLOR,
    extraTail: ',.FLOOR.',
  });

  // Roof Slabs around central skylight
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Roof Slab West',
    min: [-12, -8, 7.2],
    max: [-5.5, 8, 7.5],
    color: SLAB_COLOR,
    extraTail: ',.ROOF.',
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Roof Slab East',
    min: [5.5, -8, 7.2],
    max: [12, 8, 7.5],
    color: SLAB_COLOR,
    extraTail: ',.ROOF.',
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Roof Slab South',
    min: [-5.5, -8, 7.2],
    max: [5.5, -4.5, 7.5],
    color: SLAB_COLOR,
    extraTail: ',.ROOF.',
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCSLAB',
    name: 'Roof Slab North',
    min: [-5.5, 4.5, 7.2],
    max: [5.5, 8, 7.5],
    color: SLAB_COLOR,
    extraTail: ',.ROOF.',
  });

  // Exterior walls with 7m wide South & North flight portals
  ifc.addBoxProduct({
    ifcClass: 'IFCWALLSTANDARDCASE',
    name: 'Exterior Wall South-West',
    min: [-12, -8, 0.3],
    max: [-3.5, -7.7, 7.2],
    color: WALL_COLOR,
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCWALLSTANDARDCASE',
    name: 'Exterior Wall South-East',
    min: [3.5, -8, 0.3],
    max: [12, -7.7, 7.2],
    color: WALL_COLOR,
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCWALLSTANDARDCASE',
    name: 'Exterior Wall North-West',
    min: [-12, 7.7, 0.3],
    max: [-3.5, 8, 7.2],
    color: WALL_COLOR,
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCWALLSTANDARDCASE',
    name: 'Exterior Wall North-East',
    min: [3.5, 7.7, 0.3],
    max: [12, 8, 7.2],
    color: WALL_COLOR,
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCWALLSTANDARDCASE',
    name: 'Exterior Wall West',
    min: [-12, -7.7, 0.3],
    max: [-11.7, 7.7, 7.2],
    color: WALL_COLOR,
  });
  ifc.addBoxProduct({
    ifcClass: 'IFCWALLSTANDARDCASE',
    name: 'Exterior Wall East',
    min: [11.7, -7.7, 0.3],
    max: [12, 7.7, 7.2],
    color: WALL_COLOR,
  });

  // Interior partition walls (involved in clashes 3 and 4)
  const l1Partition = ifc.addBoxProduct({
    ifcClass: 'IFCWALLSTANDARDCASE',
    name: 'L1 Corridor Partition W-104',
    min: [-6.1, -3.5, 0.3],
    max: [-5.9, 3.5, 3.6],
    color: PARTITION_COLOR,
  });
  const l2Partition = ifc.addBoxProduct({
    ifcClass: 'IFCWALLSTANDARDCASE',
    name: 'L2 Mechanical Room Wall W-202',
    min: [7.4, -5.5, 3.9],
    max: [7.6, 5.5, 7.2],
    color: PARTITION_COLOR,
  });

  // Structural columns
  const columns = new Map();
  for (const cx of [-6, 6]) {
    for (const cy of [-4.5, 0, 4.5]) {
      const col = ifc.addBoxProduct({
        ifcClass: 'IFCCOLUMN',
        name: `Steel Column C(${cx},${cy})`,
        min: [cx - 0.22, cy - 0.22, 0.3],
        max: [cx + 0.22, cy + 0.22, 7.2],
        color: STEEL_COLOR,
      });
      columns.set(`${cx},${cy}`, col);
    }
  }

  // Structural beams
  const beams = new Map();
  for (const by of [-4.5, 0, 4.5]) {
    const beam = ifc.addBoxProduct({
      ifcClass: 'IFCBEAM',
      name: `Level 2 Girder B-Y${by}`,
      min: [-11.5, by - 0.18, 3.05],
      max: [11.5, by + 0.18, 3.6],
      color: STEEL_COLOR,
    });
    beams.set(`${by}`, beam);
  }
  for (const by of [-4.5, 4.5]) {
    ifc.addBoxProduct({
      ifcClass: 'IFCBEAM',
      name: `Roof Girder RB-Y${by}`,
      min: [-11.5, by - 0.18, 6.65],
      max: [11.5, by + 0.18, 7.2],
      color: STEEL_COLOR,
    });
  }

  // MEP Clashing Elements
  // 1. Supply Duct intersecting Central Beam B-Y0 at X=2.0, Y=0, Z=3.3
  const supplyDuct = ifc.addBoxProduct({
    ifcClass: 'IFCFLOWSEGMENT',
    name: 'Supply Air Main Duct SA-01',
    min: [1.65, -6.5, 3.0],
    max: [2.35, 6.5, 3.55],
    color: DUCT_COLOR,
  });

  // 2. Chilled Water Pipe penetrating Column (-6, -4.5)
  const cwPipe = ifc.addBoxProduct({
    ifcClass: 'IFCFLOWSEGMENT',
    name: 'Chilled Water Pipe CHW-02',
    min: [-10.5, -4.65, 2.35],
    max: [3.0, -4.35, 2.65],
    color: PIPE_COLOR,
  });

  // 3. Exhaust Duct penetrating L1 Partition W-104 without opening
  const exhaustDuct = ifc.addBoxProduct({
    ifcClass: 'IFCFLOWSEGMENT',
    name: 'Exhaust Duct EA-03',
    min: [-10.5, 1.2, 2.2],
    max: [-2.0, 1.8, 2.7],
    color: DUCT_COLOR,
  });

  // 4. L2 Return Duct penetrating L2 Mechanical Wall W-202
  const l2ReturnDuct = ifc.addBoxProduct({
    ifcClass: 'IFCFLOWSEGMENT',
    name: 'L2 Return Duct RA-04',
    min: [5.2, -1.2, 5.2],
    max: [10.8, -0.6, 5.7],
    color: DUCT_COLOR,
  });

  // 5. Fire Riser inside Column (6, 4.5)
  const fireRiser = ifc.addBoxProduct({
    ifcClass: 'IFCFLOWSEGMENT',
    name: 'Fire Standpipe FP-05',
    min: [5.9, 4.4, 0.5],
    max: [6.1, 4.6, 7.0],
    color: FIRE_COLOR,
  });

  const ifcContent = ifc.buildString();

  // Build matching BCF 2.1 archive
  const topics = [
    {
      guid: '11111111-1111-4111-8111-111111111101',
      title: 'Supply Duct SA-01 intersects L2 Girder B-Y0',
      description:
        'Main supply trunk runs straight through structural steel girder over the central atrium. Lower duct by 450mm or route through beam web opening.',
      priority: 'Critical',
      status: 'Open',
      type: 'Clash',
      author: 'coord-lead@clashflight.local',
      ifcGuids: [supplyDuct.guid, beams.get('0').guid],
      camPos: [0, -3.5, 3.3],
      camDir: [0.55, 0.83, 0],
    },
    {
      guid: '11111111-1111-4111-8111-111111111102',
      guidIndex: 2,
      title: 'Chilled Water Pipe CHW-02 hits Column C(-6,-4.5)',
      description:
        'CHW-02 centerline intersects structural column grid (-6, -4.5). Offset pipe 400mm north of column face.',
      priority: 'High',
      status: 'Open',
      type: 'Clash',
      author: 'mep-coord@clashflight.local',
      ifcGuids: [cwPipe.guid, columns.get('-6,-4.5').guid],
      camPos: [-3.5, -2.5, 2.5],
      camDir: [-0.7, -0.7, 0],
    },
    {
      guid: '11111111-1111-4111-8111-111111111103',
      title: 'Exhaust Duct EA-03 lacks penetration in Partition W-104',
      description:
        'Exhaust duct crosses Level 1 corridor partition wall W-104 with no structural/architectural opening or fire damper.',
      priority: 'High',
      status: 'Open',
      type: 'Clash',
      author: 'arch-qa@clashflight.local',
      ifcGuids: [exhaustDuct.guid, l1Partition.guid],
      camPos: [-3.0, 1.5, 2.45],
      camDir: [-1, 0, 0],
    },
    {
      guid: '11111111-1111-4111-8111-111111111104',
      title: 'L2 Return Duct RA-04 clashes with Wall W-202',
      description:
        'Level 2 return branch penetrates Mechanical Room Wall W-202 at Z=+5.45m. Add framed opening and acoustic sleeve.',
      priority: 'Medium',
      status: 'Open',
      type: 'Clash',
      author: 'mep-coord@clashflight.local',
      ifcGuids: [l2ReturnDuct.guid, l2Partition.guid],
      camPos: [5.0, -0.9, 5.45],
      camDir: [1, 0, 0],
    },
    {
      guid: '11111111-1111-4111-8111-111111111105',
      title: 'Fire Standpipe FP-05 nested inside Column C(6,4.5)',
      description:
        'Vertical fire riser shares exact XY coordinate with structural column C(6,4.5). Relocate riser adjacent to column.',
      priority: 'Low',
      status: 'Open',
      type: 'Clash',
      author: 'fire-safety@clashflight.local',
      ifcGuids: [fireRiser.guid, columns.get('6,4.5').guid],
      camPos: [3.5, 2.5, 3.8],
      camDir: [0.7, 0.7, 0],
    },
    {
      guid: '11111111-1111-4111-8111-111111111106',
      title: 'Atrium Smoke Exhaust Clearance Check (Viewpoint Only)',
      description:
        'Verify upper atrium clearance above Level 2 opening. Topic uses BCF camera fallback (no matching element GUID).',
      priority: 'Medium',
      status: 'Open',
      type: 'Request',
      author: 'bim-manager@clashflight.local',
      ifcGuids: ['0000000000000000000000'],
      camPos: [0, -2.5, 5.2],
      camDir: [0, 1, 0],
    },
  ];

  const bcfFiles = {
    'bcf.version': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1" xsi:noNamespaceSchemaLocation="version.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <DetailedVersion>2.1</DetailedVersion>\n</Version>\n`
    ),
  };

  for (const t of topics) {
    const vpGuid = `${t.guid.slice(0, 34)}ff`;
    const markup = `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <File IfcProject="${makeDeterministicIfcGuid(1)}">
      <Filename>clashflight-sample.ifc</Filename>
    </File>
  </Header>
  <Topic Guid="${t.guid}" TopicType="${t.type}" TopicStatus="${t.status}">
    <Title>${escapeXml(t.title)}</Title>
    <Priority>${escapeXml(t.priority)}</Priority>
    <CreationDate>2026-11-21T12:00:00Z</CreationDate>
    <CreationAuthor>${escapeXml(t.author)}</CreationAuthor>
    <Description>${escapeXml(t.description)}</Description>
  </Topic>
  <Viewpoints Guid="${vpGuid}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>
  </Viewpoints>
</Markup>
`;

    const selectionXml = t.ifcGuids
      .map((g) => `      <Component IfcGuid="${g}" />`)
      .join('\n');

    const viewpoint = `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${vpGuid}">
  <Components>
    <Selection>
${selectionXml}
    </Selection>
  </Components>
  <PerspectiveCamera>
    <CameraViewPoint>
      <X>${t.camPos[0]}</X>
      <Y>${t.camPos[1]}</Y>
      <Z>${t.camPos[2]}</Z>
    </CameraViewPoint>
    <CameraDirection>
      <X>${t.camDir[0]}</X>
      <Y>${t.camDir[1]}</Y>
      <Z>${t.camDir[2]}</Z>
    </CameraDirection>
    <CameraUpVector>
      <X>0</X>
      <Y>0</Y>
      <Z>1</Z>
    </CameraUpVector>
    <FieldOfView>60</FieldOfView>
  </PerspectiveCamera>
</VisualizationInfo>
`;

    bcfFiles[`${t.guid}/markup.bcf`] = strToU8(markup);
    bcfFiles[`${t.guid}/viewpoint.bcfv`] = strToU8(viewpoint);
  }

  const bcfZipBytes = zipSync(bcfFiles);

  const samplesDir = path.resolve(rootDir, 'samples');
  const publicSamplesDir = path.resolve(
    rootDir,
    'packages/app/public/samples'
  );
  fs.mkdirSync(samplesDir, { recursive: true });
  fs.mkdirSync(publicSamplesDir, { recursive: true });

  fs.writeFileSync(
    path.join(samplesDir, 'clashflight-sample.ifc'),
    ifcContent,
    'utf8'
  );
  fs.writeFileSync(
    path.join(samplesDir, 'clashflight-sample.bcfzip'),
    bcfZipBytes
  );
  fs.writeFileSync(
    path.join(publicSamplesDir, 'clashflight-sample.ifc'),
    ifcContent,
    'utf8'
  );
  fs.writeFileSync(
    path.join(publicSamplesDir, 'clashflight-sample.bcfzip'),
    bcfZipBytes
  );

  console.log(
    `Generated clashflight-sample.ifc (${ifcContent.length} bytes) and clashflight-sample.bcfzip (${bcfZipBytes.length} bytes)`
  );
}

function escapeXml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

buildSampleModelAndBcf();
