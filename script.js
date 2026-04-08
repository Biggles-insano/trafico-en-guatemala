/**
 * TraficoGT - Web Traffic Simulator
 * Core JavaScript Logic
 */

// --- UTILS & MATH ---
class Vector2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    
    add(v) { return new Vector2(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vector2(this.x - v.x, this.y - v.y); }
    mult(n) { return new Vector2(this.x * n, this.y * n); }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    normalize() {
        const m = this.mag();
        return m === 0 ? new Vector2(0, 0) : new Vector2(this.x/m, this.y/m);
    }
    dist(v) {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        return Math.sqrt(dx*dx + dy*dy);
    }
    // Perpendicular vector for lane offsets
    perp() { return new Vector2(-this.y, this.x); }
}

const CONSTANTS = {
    GRID_SIZE: 40,
    LANE_WIDTH: 18,
    CAR_WIDTH: 10,
    CAR_LENGTH: 18,
    LANE_MARKER_DASH: [10, 10],
    SNAP_DISTANCE: 20
};

// --- DATA MODELS ---

class Node {
    constructor(x, y) {
        this.id = Date.now() + Math.random();
        this.pos = new Vector2(x, y);
        this.connectedRoads = [];
    }
}

class Road {
    constructor(nodeA, nodeB, lanes, isTwoWay) {
        this.id = Date.now() + Math.random();
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.lanes = lanes;       // Number of lanes PER direction
        this.isTwoWay = isTwoWay; // true or false
        
        nodeA.connectedRoads.push(this);
        nodeB.connectedRoads.push(this);
    }
    
    // Calculates the paths for each lane to help cars navigate and for drawing
    getPaths() {
        const paths = [];
        const dir = this.nodeB.pos.sub(this.nodeA.pos).normalize();
        const perp = dir.perp();
        
        // Calculate total road width offset
        const totalLanes = this.isTwoWay ? this.lanes * 2 : this.lanes;
        const startOffset = -(totalLanes * CONSTANTS.LANE_WIDTH) / 2 + (CONSTANTS.LANE_WIDTH / 2);

        // Forward lanes (A to B)
        for (let i = 0; i < this.lanes; i++) {
            let offsetMult = this.isTwoWay ? i + this.lanes : i;
            let offsetVec = perp.mult(startOffset + (offsetMult * CONSTANTS.LANE_WIDTH));
            
            paths.push({
                direction: 'forward',
                from: this.nodeA.pos.add(offsetVec),
                to: this.nodeB.pos.add(offsetVec),
                roadId: this.id
            });
        }

        // Backward lanes (B to A)
        if (this.isTwoWay) {
            for (let i = 0; i < this.lanes; i++) {
                let offsetMult = (this.lanes - 1 - i); 
                let offsetVec = perp.mult(startOffset + (offsetMult * CONSTANTS.LANE_WIDTH));
                
                paths.push({
                    direction: 'backward',
                    from: this.nodeB.pos.add(offsetVec),
                    to: this.nodeA.pos.add(offsetVec),
                    roadId: this.id
                });
            }
        }
        return paths;
    }
}

class Car {
    constructor(path) {
        this.pos = new Vector2(path.from.x, path.from.y);
        this.target = new Vector2(path.to.x, path.to.y);
        this.maxSpeed = 1.5 + Math.random() * 1.5;
        this.speed = 0;
        this.dir = this.target.sub(this.pos).normalize();
        this.color = `hsl(${Math.random() * 360}, 70%, 60%)`;
        this.active = true;
    }

    update() {
        if (!this.active) return;
        
        // Accelerate
        if (this.speed < this.maxSpeed) this.speed += 0.05;
        
        // Move
        const velocity = this.dir.mult(this.speed);
        this.pos = this.pos.add(velocity);

        // Check if reached destination
        if (this.pos.dist(this.target) < this.speed) {
            this.active = false; // For now, just despawn when reaching the end of the road
        }
    }

    draw(ctx) {
        if (!this.active) return;
        
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        
        // Calculate angle
        const angle = Math.atan2(this.dir.y, this.dir.x);
        ctx.rotate(angle);

        // Draw car
        ctx.fillStyle = this.color;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.roundRect(-CONSTANTS.CAR_LENGTH / 2, -CONSTANTS.CAR_WIDTH / 2, CONSTANTS.CAR_LENGTH, CONSTANTS.CAR_WIDTH, 3);
        ctx.fill();

        // Draw headlights
        ctx.fillStyle = 'rgba(255, 255, 200, 0.8)';
        ctx.fillRect(CONSTANTS.CAR_LENGTH / 2 - 2, -CONSTANTS.CAR_WIDTH / 2 + 1, 3, 2);
        ctx.fillRect(CONSTANTS.CAR_LENGTH / 2 - 2, CONSTANTS.CAR_WIDTH / 2 - 3, 3, 2);

        ctx.restore();
    }
}

// --- APP STATE ---
const state = {
    mode: 'draw', // 'draw', 'erase'
    lanes: 1,
    isTwoWay: true,
    simRunning: false,
    density: 30, // % chance to spawn

    nodes: [],
    roads: [],
    cars: [],

    mouse: new Vector2(0, 0),
    snappedMouse: new Vector2(0, 0),
    isDragging: false,
    dragStartNode: null
};

// --- DOM ELEMENTS ---
const canvas = document.getElementById('city-canvas');
const ctx = canvas.getContext('2d');

const laneCountDisp = document.getElementById('lane-count-display');
const roadTypeSelect = document.getElementById('road-type');
const btnToggleSim = document.getElementById('btn-toggle-sim');
const simIcon = document.getElementById('sim-icon');
const simText = document.getElementById('sim-text');
const btnDraw = document.getElementById('tool-draw');
const btnErase = document.getElementById('tool-erase');

const statusMode = document.getElementById('status-mode');
const statusCoords = document.getElementById('status-coords');
const statusCars = document.getElementById('status-cars');

// --- INIT & EVENT LISTENERS ---

function resize() {
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
}
window.addEventListener('resize', resize);
resize();

// UI Events
document.getElementById('lane-decrease').addEventListener('click', () => {
    if (state.lanes > 1) { state.lanes--; laneCountDisp.innerText = state.lanes; }
});
document.getElementById('lane-increase').addEventListener('click', () => {
    if (state.lanes < 4) { state.lanes++; laneCountDisp.innerText = state.lanes; }
});
roadTypeSelect.addEventListener('change', (e) => {
    state.isTwoWay = e.target.value === 'two-way';
});
document.getElementById('traffic-density').addEventListener('input', (e) => {
    state.density = parseInt(e.target.value);
});

btnDraw.addEventListener('click', () => setMode('draw'));
btnErase.addEventListener('click', () => setMode('erase'));

function setMode(mode) {
    state.mode = mode;
    btnDraw.classList.toggle('active', mode === 'draw');
    btnErase.classList.toggle('active', mode === 'erase');
    statusMode.innerText = `Modo: ${mode === 'draw' ? 'Dibujar Calles' : 'Borrar Calles'}`;
}

btnToggleSim.addEventListener('click', () => {
    state.simRunning = !state.simRunning;
    if (state.simRunning) {
        btnToggleSim.classList.add('sim-running');
        simIcon.name = 'pause-outline';
        simText.innerText = 'Pausar Tráfico';
    } else {
        btnToggleSim.classList.remove('sim-running');
        simIcon.name = 'play-outline';
        simText.innerText = 'Iniciar Tráfico';
    }
});

document.getElementById('btn-clear-all').addEventListener('click', () => {
    if(confirm('¿Seguro que deseas limpiar la ciudad?')) {
        state.nodes = [];
        state.roads = [];
        state.cars = [];
    }
});

// Canvas Events
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
    
    // Snap to grid
    state.snappedMouse.x = Math.round(state.mouse.x / CONSTANTS.GRID_SIZE) * CONSTANTS.GRID_SIZE;
    state.snappedMouse.y = Math.round(state.mouse.y / CONSTANTS.GRID_SIZE) * CONSTANTS.GRID_SIZE;
    
    statusCoords.innerText = `X: ${state.snappedMouse.x}, Y: ${state.snappedMouse.y}`;
});

canvas.addEventListener('mousedown', (e) => {
    if(e.button !== 0) return; // Only left click
    
    if (state.mode === 'draw') {
        const snapNode = getHoveredNode(state.snappedMouse);
        state.isDragging = true;
        
        if (snapNode) {
            state.dragStartNode = snapNode;
        } else {
            const newNode = new Node(state.snappedMouse.x, state.snappedMouse.y);
            state.nodes.push(newNode);
            state.dragStartNode = newNode;
        }
    } else if (state.mode === 'erase') {
        // Find road near mouse
        const roadToRemove = getHoveredRoad(state.mouse);
        if (roadToRemove) {
            state.roads = state.roads.filter(r => r !== roadToRemove);
            // Optional: clean up orphaned nodes
            cleanUpNodes();
        }
    }
});

canvas.addEventListener('mouseup', () => {
    if (state.isDragging && state.mode === 'draw') {
        state.isDragging = false;
        
        // Prevent drawing dot to self
        if (state.dragStartNode.pos.dist(state.snappedMouse) > CONSTANTS.GRID_SIZE - 5) {
            const snapEndNode = getHoveredNode(state.snappedMouse);
            let endNode = snapEndNode;
            
            if (!endNode) {
                endNode = new Node(state.snappedMouse.x, state.snappedMouse.y);
                state.nodes.push(endNode);
            }
            
            // Create road
            const newRoad = new Road(state.dragStartNode, endNode, state.lanes, state.isTwoWay);
            state.roads.push(newRoad);
        } else {
            // Clean up standalone nodes if we just clicked without dragging
            cleanUpNodes();
        }
        state.dragStartNode = null;
    }
});

// --- HELPER FUNCTIONS ---

function getHoveredNode(pos) {
    for (let node of state.nodes) {
        if (node.pos.dist(pos) < CONSTANTS.SNAP_DISTANCE) return node;
    }
    return null;
}

function getHoveredRoad(mousePos) {
    // Basic point-line distance check
    for (let road of state.roads) {
        const dist = pointToSegmentDistance(mousePos, road.nodeA.pos, road.nodeB.pos);
        const totalWidth = (road.isTwoWay ? road.lanes * 2 : road.lanes) * CONSTANTS.LANE_WIDTH;
        if (dist < totalWidth / 2 + 5) {
            return road;
        }
    }
    return null;
}

function pointToSegmentDistance(p, v, w) {
    const l2 = v.dist(w) ** 2;
    if (l2 === 0) return p.dist(v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return p.dist(new Vector2(v.x + t * (w.x - v.x), v.y + t * (w.y - v.y)));
}

function cleanUpNodes() {
    // Keep nodes that have connected roads in the main roads list
    const activeNodes = new Set();
    for (let road of state.roads) {
        activeNodes.add(road.nodeA);
        activeNodes.add(road.nodeB);
    }
    state.nodes = state.nodes.filter(n => activeNodes.has(n));
}

// --- RENDER & SIMULATION LOOP ---

function drawGrid() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    
    // Draw grid lines
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += CONSTANTS.GRID_SIZE) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
    }
    for (let y = 0; y <= canvas.height; y += CONSTANTS.GRID_SIZE) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    // Subtle highlight on snap points
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.arc(state.snappedMouse.x, state.snappedMouse.y, 4, 0, Math.PI * 2);
    ctx.fill();
}

function drawRoads() {
    // Draw base asphalt
    ctx.lineCap = 'butt';
    
    state.roads.forEach(road => {
        const totalLanes = road.isTwoWay ? road.lanes * 2 : road.lanes;
        const totalWidth = totalLanes * CONSTANTS.LANE_WIDTH;
        
        // Base dark grey
        ctx.beginPath();
        ctx.moveTo(road.nodeA.pos.x, road.nodeA.pos.y);
        ctx.lineTo(road.nodeB.pos.x, road.nodeB.pos.y);
        ctx.lineWidth = totalWidth;
        ctx.strokeStyle = '#334155'; // Slate 700
        ctx.stroke();

        // Draw Lane dividers
        const paths = road.getPaths();
        const dir = road.nodeB.pos.sub(road.nodeA.pos).normalize();
        const perp = dir.perp();
        
        ctx.lineWidth = 2;
        
        // Draw markings based on lane paths calculated earlier offset slightly
        if (road.isTwoWay) {
            // Draw center double yellow line
            ctx.beginPath();
            ctx.moveTo(road.nodeA.pos.x, road.nodeA.pos.y);
            ctx.lineTo(road.nodeB.pos.x, road.nodeB.pos.y);
            ctx.strokeStyle = '#fbbf24'; // Yellow
            ctx.setLineDash([]);
            ctx.stroke();
        }

        // Draw white dashes between lanes moving same direction
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.setLineDash(CONSTANTS.LANE_MARKER_DASH);
        
        for (let i = 1; i < road.lanes; i++) {
            // Forward lane marks
            let offset = road.isTwoWay ? i * CONSTANTS.LANE_WIDTH : (-totalWidth/2 + i * CONSTANTS.LANE_WIDTH);
            let pVec = perp.mult(offset);
            ctx.beginPath();
            ctx.moveTo(road.nodeA.pos.x + pVec.x, road.nodeA.pos.y + pVec.y);
            ctx.lineTo(road.nodeB.pos.x + pVec.x, road.nodeB.pos.y + pVec.y);
            ctx.stroke();
            
            // Backward lane marks if two way
            if (road.isTwoWay) {
                let backOffset = -i * CONSTANTS.LANE_WIDTH;
                let bpVec = perp.mult(backOffset);
                ctx.beginPath();
                ctx.moveTo(road.nodeA.pos.x + bpVec.x, road.nodeA.pos.y + bpVec.y);
                ctx.lineTo(road.nodeB.pos.x + bpVec.x, road.nodeB.pos.y + bpVec.y);
                ctx.stroke();
            }
        }
        ctx.setLineDash([]); // reset
    });

    // Draw Nodes (Intersections)
    ctx.fillStyle = '#334155';
    state.nodes.forEach(node => {
        // Calculate max width connected to this intersection to draw circle
        let maxWidth = 0;
        node.connectedRoads.forEach(r => {
            const w = (r.isTwoWay ? r.lanes * 2 : r.lanes) * CONSTANTS.LANE_WIDTH;
            if (w > maxWidth) maxWidth = w;
        });
        
        if (maxWidth > 0) {
            ctx.beginPath();
            ctx.arc(node.pos.x, node.pos.y, maxWidth / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

function drawUIOverlay() {
    if (state.isDragging && state.mode === 'draw') {
        ctx.beginPath();
        ctx.moveTo(state.dragStartNode.pos.x, state.dragStartNode.pos.y);
        ctx.lineTo(state.snappedMouse.x, state.snappedMouse.y);
        ctx.lineWidth = (state.isTwoWay ? state.lanes * 2 : state.lanes) * CONSTANTS.LANE_WIDTH;
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; // Blue highlight
        ctx.lineCap = 'round';
        ctx.stroke();
    }
}

function handleSimulation() {
    if (!state.simRunning) return;

    // Spawn cars randomly on existing paths
    if (Math.random() < (state.density / 1000) && state.roads.length > 0) {
        // Pick random road
        const randomRoad = state.roads[Math.floor(Math.random() * state.roads.length)];
        const paths = randomRoad.getPaths();
        if (paths.length > 0) {
            const randomPath = paths[Math.floor(Math.random() * paths.length)];
            state.cars.push(new Car(randomPath));
        }
    }

    // Filter active cars
    state.cars = state.cars.filter(car => car.active);

    // Update cars
    state.cars.forEach(car => {
        car.update();
    });
}

function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // clear fully transparent for canvas bg

    drawGrid();
    drawRoads();
    
    handleSimulation();
    
    state.cars.forEach(car => car.draw(ctx));
    
    drawUIOverlay();

    statusCars.innerText = `Vehículos: ${state.cars.length}`;

    requestAnimationFrame(loop);
}

// Start Loop
requestAnimationFrame(loop);
