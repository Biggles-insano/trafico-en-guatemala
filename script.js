/**
 * TraficoGT - Web Traffic Simulator
 * Advanced Physical & AI Motor
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
    perp() { return new Vector2(-this.y, this.x); }
    static lerp(start, end, amt) {
        return new Vector2(start.x + (end.x - start.x) * amt, start.y + (end.y - start.y) * amt);
    }
}

const CONSTANTS = {
    GRID_SIZE: 40,
    LANE_WIDTH: 18,
    CAR_WIDTH: 10,
    CAR_LENGTH: 18,
    LANE_MARKER_DASH: [10, 10],
    SNAP_DISTANCE: 20,
    SAFE_DISTANCE: 30, // Distance to keep from car ahead
    TL_GREEN_TIME: 150, // frames
    TL_YELLOW_TIME: 60,
    TL_RED_TIME: 150
};

// --- DATA MODELS ---

class TrafficLightController {
    constructor(node) {
        this.node = node;
        this.roads = node.connectedRoads;
        this.timer = 0;
        this.stateIndex = 0;
        
        // Group roads arbitrarily into two phases (e.g., evens and odds)
        this.groups = [[], []];
        this.roads.forEach((r, i) => {
            this.groups[i % 2].push(r);
        });

        // stateIndex: 0 = G1, 1 = Y1, 2 = G2, 3 = Y2
        this.states = [
            { duration: CONSTANTS.TL_GREEN_TIME, colors: ['green', 'red'] },
            { duration: CONSTANTS.TL_YELLOW_TIME, colors: ['yellow', 'red'] },
            { duration: CONSTANTS.TL_GREEN_TIME, colors: ['red', 'green'] },
            { duration: CONSTANTS.TL_YELLOW_TIME, colors: ['red', 'yellow'] }
        ];
    }

    update() {
        if (this.groups[0].length === 0 && this.groups[1].length === 0) return;
        this.timer++;
        if (this.timer >= this.states[this.stateIndex].duration) {
            this.timer = 0;
            this.stateIndex = (this.stateIndex + 1) % this.states.length;
        }
    }

    // Returns 'green', 'yellow', or 'red' for a specific road approaching this node
    getColorForRoad(road) {
        const groupIndex = this.groups[0].includes(road) ? 0 : 1;
        return this.states[this.stateIndex].colors[groupIndex];
    }
}

class Node {
    constructor(x, y) {
        this.id = Date.now() + Math.random();
        this.pos = new Vector2(x, y);
        this.connectedRoads = [];
        this.trafficLight = null;
    }

    addRoad(road) {
        if (!this.connectedRoads.includes(road)) {
            this.connectedRoads.push(road);
        }
        if (this.connectedRoads.length > 2 && !this.trafficLight) {
            this.trafficLight = new TrafficLightController(this);
        } else if (this.trafficLight) {
            this.trafficLight.roads = this.connectedRoads;
            // Regroup
            this.trafficLight.groups = [[], []];
            this.trafficLight.roads.forEach((r, i) => {
                this.trafficLight.groups[i % 2].push(r);
            });
        }
    }
}

class Lane {
    constructor(road, from, to, index, directionType) {
        this.road = road;
        this.from = from;
        this.to = to;
        this.index = index;
        this.directionType = directionType; // 'forward' or 'backward'
        this.cars = []; // Store cars currently on this lane
        this.dir = to.sub(from).normalize();
        this.length = from.dist(to);
    }
}

class Road {
    constructor(nodeA, nodeB, lanesCount, isTwoWay) {
        this.id = Date.now() + Math.random();
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.lanesCount = lanesCount;       
        this.isTwoWay = isTwoWay; 
        
        this.forwardLanes = [];
        this.backwardLanes = [];

        this.buildLanes();

        nodeA.addRoad(this);
        nodeB.addRoad(this);
    }

    buildLanes() {
        const dir = this.nodeB.pos.sub(this.nodeA.pos).normalize();
        const perp = dir.perp();
        
        const totalLanes = this.isTwoWay ? this.lanesCount * 2 : this.lanesCount;
        const startOffset = -(totalLanes * CONSTANTS.LANE_WIDTH) / 2 + (CONSTANTS.LANE_WIDTH / 2);

        // Forward lanes (A to B)
        for (let i = 0; i < this.lanesCount; i++) {
            let offsetMult = this.isTwoWay ? i + this.lanesCount : i;
            let offsetVec = perp.mult(startOffset + (offsetMult * CONSTANTS.LANE_WIDTH));
            
            this.forwardLanes.push(new Lane(
                this,
                this.nodeA.pos.add(offsetVec),
                this.nodeB.pos.add(offsetVec),
                i,
                'forward'
            ));
        }

        // Backward lanes (B to A)
        if (this.isTwoWay) {
            for (let i = 0; i < this.lanesCount; i++) {
                let offsetMult = (this.lanesCount - 1 - i); 
                let offsetVec = perp.mult(startOffset + (offsetMult * CONSTANTS.LANE_WIDTH));
                
                this.backwardLanes.push(new Lane(
                    this,
                    this.nodeB.pos.add(offsetVec),
                    this.nodeA.pos.add(offsetVec),
                    i,
                    'backward'
                ));
            }
        }
    }
}

class Car {
    constructor(lane) {
        this.lane = lane;
        this.lane.cars.push(this);
        
        this.distanceTravelled = 0;
        this.pos = new Vector2(lane.from.x, lane.from.y);
        
        // Physics
        this.speed = 0;
        this.maxSpeed = 1.5 + Math.random() * 1.0;
        this.accel = 0.05;
        this.decel = 0.1;
        
        this.color = `hsl(${Math.random() * 360}, 70%, 60%)`;
        this.active = true;

        // Visual Lane Change
        this.laneChangeOffset = 0; 
    }

    update(chaosLevel) {
        if (!this.active) return;
        
        // 1. Find car ahead in the same lane
        let carAhead = null;
        let minAheadDist = Infinity;
        for (let other of this.lane.cars) {
            if (other !== this && other.distanceTravelled > this.distanceTravelled) {
                let dist = other.distanceTravelled - this.distanceTravelled - CONSTANTS.CAR_LENGTH;
                if (dist < minAheadDist) {
                    minAheadDist = dist;
                    carAhead = other;
                }
            }
        }

        // 2. Check traffic light
        let isRedLight = false;
        let distToLight = this.lane.length - this.distanceTravelled;
        if (distToLight > 0 && distToLight < CONSTANTS.SAFE_DISTANCE * 2) { // Close to intersection
            const endNode = this.lane.directionType === 'forward' ? this.lane.road.nodeB : this.lane.road.nodeA;
            if (endNode.trafficLight) {
                const color = endNode.trafficLight.getColorForRoad(this.lane.road);
                if (color === 'red' || color === 'yellow') {
                    isRedLight = true;
                    if (distToLight < minAheadDist) {
                        minAheadDist = distToLight;
                        carAhead = 'LIGHT'; // Fake obstacle
                    }
                }
            }
        }

        // 3. Accelerate or Brake
        if (minAheadDist < CONSTANTS.SAFE_DISTANCE) {
            // Brake
            if (this.speed > 0) {
                this.speed -= this.decel;
                if (this.speed < 0) this.speed = 0;
            }
            
            // 4. Try Lane Change if stuck
            if (this.speed < this.maxSpeed * 0.5 && this.laneChangeOffset === 0) {
                this.tryLaneChange();
            }
        } else {
            // Accelerate
            if (this.speed < this.maxSpeed) {
                this.speed += this.accel;
            }
            
            // Random chaotic lane change
            if (chaosLevel > 0 && this.laneChangeOffset === 0 && Math.random() < (chaosLevel * 0.0001)) {
                this.tryLaneChange();
            }
        }

        // 5. Move
        this.distanceTravelled += this.speed;
        
        // 6. Smooth lane transition visual
        if (this.laneChangeOffset !== 0) {
            this.laneChangeOffset *= 0.85; // Approach 0
            if (Math.abs(this.laneChangeOffset) < 0.5) this.laneChangeOffset = 0;
        }

        // Apply pos on line + offset perpendicular
        const basePos = this.lane.from.add(this.lane.dir.mult(this.distanceTravelled));
        const perp = this.lane.dir.perp();
        this.pos = basePos.add(perp.mult(this.laneChangeOffset));

        // 7. Check destination
        if (this.distanceTravelled >= this.lane.length) {
            this.active = false; 
            // Cleanup from lane
            this.lane.cars = this.lane.cars.filter(c => c !== this);
        }
    }

    tryLaneChange() {
        const siblings = this.lane.directionType === 'forward' ? this.lane.road.forwardLanes : this.lane.road.backwardLanes;
        const currentIndex = this.lane.index;
        
        // Potential lanes
        const leftTarget = currentIndex - 1;
        const rightTarget = currentIndex + 1;
        
        let targetLane = null;
        let pDir = 0;
        
        // Randomly prefer left or right first
        const checkLeftFirst = Math.random() > 0.5;
        
        if (checkLeftFirst) {
            if (this.isLaneSafe(siblings[leftTarget])) { targetLane = siblings[leftTarget]; pDir = -1; }
            else if (this.isLaneSafe(siblings[rightTarget])) { targetLane = siblings[rightTarget]; pDir = 1; }
        } else {
            if (this.isLaneSafe(siblings[rightTarget])) { targetLane = siblings[rightTarget]; pDir = 1; }
            else if (this.isLaneSafe(siblings[leftTarget])) { targetLane = siblings[leftTarget]; pDir = -1; }
        }

        if (targetLane) {
            // Remove from old
            this.lane.cars = this.lane.cars.filter(c => c !== this);
            // Add to new
            this.lane = targetLane;
            this.lane.cars.push(this);
            // Visual offset
            let offsetSign = (this.lane.directionType === 'forward') ? 1 : -1;
            this.laneChangeOffset = -pDir * CONSTANTS.LANE_WIDTH * offsetSign;
        }
    }

    isLaneSafe(targetLane) {
        if (!targetLane) return false;
        // Check if there is a car too close in target lane
        for (let other of targetLane.cars) {
            let dist = Math.abs(other.distanceTravelled - this.distanceTravelled);
            if (dist < CONSTANTS.CAR_LENGTH * 2.5) {
                return false; // too close
            }
        }
        return true;
    }

    draw(ctx) {
        if (!this.active) return;
        
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        
        const angle = Math.atan2(this.lane.dir.y, this.lane.dir.x);
        ctx.rotate(angle);

        ctx.fillStyle = this.color;
        
        // Brake light effect
        if (this.speed === 0) {
            ctx.shadowColor = 'red';
            ctx.shadowBlur = 10;
        } else {
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 4;
        }
        ctx.shadowOffsetY = 2;

        ctx.beginPath();
        ctx.roundRect(-CONSTANTS.CAR_LENGTH / 2, -CONSTANTS.CAR_WIDTH / 2, CONSTANTS.CAR_LENGTH, CONSTANTS.CAR_WIDTH, 3);
        ctx.fill();

        // Braking visual
        if (this.speed < this.maxSpeed * 0.2) {
             ctx.fillStyle = 'red';
             ctx.fillRect(-CONSTANTS.CAR_LENGTH / 2, -CONSTANTS.CAR_WIDTH / 2, 2, CONSTANTS.CAR_WIDTH);
        }

        // Headlights
        ctx.fillStyle = 'rgba(255, 255, 200, 0.8)';
        ctx.fillRect(CONSTANTS.CAR_LENGTH / 2 - 2, -CONSTANTS.CAR_WIDTH / 2 + 1, 3, 2);
        ctx.fillRect(CONSTANTS.CAR_LENGTH / 2 - 2, CONSTANTS.CAR_WIDTH / 2 - 3, 3, 2);

        ctx.restore();
    }
}

// --- APP STATE ---
const state = {
    mode: 'draw', 
    lanes: 1,
    isTwoWay: true,
    simRunning: false,
    density: 30,
    chaos: 10,

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
document.getElementById('lane-chaos').addEventListener('input', (e) => {
    state.chaos = parseInt(e.target.value);
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
    
    state.snappedMouse.x = Math.round(state.mouse.x / CONSTANTS.GRID_SIZE) * CONSTANTS.GRID_SIZE;
    state.snappedMouse.y = Math.round(state.mouse.y / CONSTANTS.GRID_SIZE) * CONSTANTS.GRID_SIZE;
    
    statusCoords.innerText = `X: ${state.snappedMouse.x}, Y: ${state.snappedMouse.y}`;
});

canvas.addEventListener('mousedown', (e) => {
    if(e.button !== 0) return; 
    
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
        const roadToRemove = getHoveredRoad(state.mouse);
        if (roadToRemove) {
            // Remove from nodes
            roadToRemove.nodeA.connectedRoads = roadToRemove.nodeA.connectedRoads.filter(r => r !== roadToRemove);
            roadToRemove.nodeB.connectedRoads = roadToRemove.nodeB.connectedRoads.filter(r => r !== roadToRemove);
            
            // Remove road
            state.roads = state.roads.filter(r => r !== roadToRemove);
            
            // Recalculate Traffic Lights for nodes
            if (roadToRemove.nodeA.connectedRoads.length <= 2) roadToRemove.nodeA.trafficLight = null;
            if (roadToRemove.nodeB.connectedRoads.length <= 2) roadToRemove.nodeB.trafficLight = null;

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
            
            // Prevent duplicate roads entirely mapping same nodes directly
            const exists = state.roads.find(r => 
                (r.nodeA === state.dragStartNode && r.nodeB === endNode) || 
                (r.nodeB === state.dragStartNode && r.nodeA === endNode)
            );

            if (!exists) {
                const newRoad = new Road(state.dragStartNode, endNode, state.lanes, state.isTwoWay);
                state.roads.push(newRoad);
            }
        }
        cleanUpNodes();
        state.dragStartNode = null;
    }
});

function getHoveredNode(pos) {
    for (let node of state.nodes) {
        if (node.pos.dist(pos) < CONSTANTS.SNAP_DISTANCE) return node;
    }
    return null;
}

function getHoveredRoad(mousePos) {
    for (let road of state.roads) {
        const dist = pointToSegmentDistance(mousePos, road.nodeA.pos, road.nodeB.pos);
        const totalWidth = (road.isTwoWay ? road.lanesCount * 2 : road.lanesCount) * CONSTANTS.LANE_WIDTH;
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

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.arc(state.snappedMouse.x, state.snappedMouse.y, 4, 0, Math.PI * 2);
    ctx.fill();
}

function drawRoads() {
    ctx.lineCap = 'butt';
    
    state.roads.forEach(road => {
        const totalLanes = road.isTwoWay ? road.lanesCount * 2 : road.lanesCount;
        const totalWidth = totalLanes * CONSTANTS.LANE_WIDTH;
        
        // Base dark grey
        ctx.beginPath();
        ctx.moveTo(road.nodeA.pos.x, road.nodeA.pos.y);
        ctx.lineTo(road.nodeB.pos.x, road.nodeB.pos.y);
        ctx.lineWidth = totalWidth;
        ctx.strokeStyle = '#334155';
        ctx.stroke();

        const dir = road.nodeB.pos.sub(road.nodeA.pos).normalize();
        const perp = dir.perp();
        ctx.lineWidth = 2;
        
        if (road.isTwoWay) {
            ctx.beginPath();
            ctx.moveTo(road.nodeA.pos.x, road.nodeA.pos.y);
            ctx.lineTo(road.nodeB.pos.x, road.nodeB.pos.y);
            ctx.strokeStyle = '#fbbf24';
            ctx.setLineDash([]);
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.setLineDash(CONSTANTS.LANE_MARKER_DASH);
        
        for (let i = 1; i < road.lanesCount; i++) {
            let offset = road.isTwoWay ? i * CONSTANTS.LANE_WIDTH : (-totalWidth/2 + i * CONSTANTS.LANE_WIDTH);
            let pVec = perp.mult(offset);
            ctx.beginPath();
            ctx.moveTo(road.nodeA.pos.x + pVec.x, road.nodeA.pos.y + pVec.y);
            ctx.lineTo(road.nodeB.pos.x + pVec.x, road.nodeB.pos.y + pVec.y);
            ctx.stroke();
            
            if (road.isTwoWay) {
                let backOffset = -i * CONSTANTS.LANE_WIDTH;
                let bpVec = perp.mult(backOffset);
                ctx.beginPath();
                ctx.moveTo(road.nodeA.pos.x + bpVec.x, road.nodeA.pos.y + bpVec.y);
                ctx.lineTo(road.nodeB.pos.x + bpVec.x, road.nodeB.pos.y + bpVec.y);
                ctx.stroke();
            }
        }
        ctx.setLineDash([]); 

        // Draw Traffic Lights at the end of each road approaching an intersection
        if (road.nodeB.trafficLight) drawTrafficLightMarkings(road, road.nodeB, 'forward');
        if (road.isTwoWay && road.nodeA.trafficLight) drawTrafficLightMarkings(road, road.nodeA, 'backward');
    });

    // Draw Intersections
    ctx.fillStyle = '#334155';
    state.nodes.forEach(node => {
        let maxWidth = 0;
        node.connectedRoads.forEach(r => {
            const w = (r.isTwoWay ? r.lanesCount * 2 : r.lanesCount) * CONSTANTS.LANE_WIDTH;
            if (w > maxWidth) maxWidth = w;
        });
        
        if (maxWidth > 0) {
            ctx.beginPath();
            ctx.arc(node.pos.x, node.pos.y, maxWidth / 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Update Traffic Lights
        if (node.trafficLight) node.trafficLight.update();
    });
}

function drawTrafficLightMarkings(road, node, directionType) {
    const isNodeB = node === road.nodeB;
    const color = node.trafficLight.getColorForRoad(road);
    
    const lines = directionType === 'forward' ? road.forwardLanes : road.backwardLanes;
    
    // Position slightly before the intersection
    lines.forEach(lane => {
        // Find position near end of lane
        const t = (lane.length - 15) / lane.length; 
        const lightPos = lane.from.add(lane.dir.mult(lane.length - 15));
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lightPos.x, lightPos.y, 4, 0, Math.PI*2);
        ctx.fill();
        
        // Stop Line
        ctx.strokeStyle = color === 'green' ? 'rgba(0,255,0,0.2)' : color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const p1 = lightPos.add(lane.dir.perp().mult(CONSTANTS.LANE_WIDTH / 2));
        const p2 = lightPos.sub(lane.dir.perp().mult(CONSTANTS.LANE_WIDTH / 2));
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    });
}

function drawUIOverlay() {
    if (state.isDragging && state.mode === 'draw') {
        ctx.beginPath();
        ctx.moveTo(state.dragStartNode.pos.x, state.dragStartNode.pos.y);
        ctx.lineTo(state.snappedMouse.x, state.snappedMouse.y);
        ctx.lineWidth = (state.isTwoWay ? state.lanes * 2 : state.lanes) * CONSTANTS.LANE_WIDTH;
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; 
        ctx.lineCap = 'round';
        ctx.stroke();
    }
}

function handleSimulation() {
    if (!state.simRunning) return;

    if (Math.random() < (state.density / 300) && state.roads.length > 0) {
        const randomRoad = state.roads[Math.floor(Math.random() * state.roads.length)];
        // Choose forward or backward randomly if twoway
        let targetLanes = randomRoad.forwardLanes;
        if (randomRoad.isTwoWay && Math.random() > 0.5) targetLanes = randomRoad.backwardLanes;
        
        if (targetLanes.length > 0) {
            const spawnLane = targetLanes[Math.floor(Math.random() * targetLanes.length)];
            // Only spawn if safe at start of lane
            let safeSpawn = true;
            for(let c of spawnLane.cars) {
                if (c.distanceTravelled < CONSTANTS.CAR_LENGTH * 3) {
                    safeSpawn = false; break;
                }
            }
            if (safeSpawn) {
                state.cars.push(new Car(spawnLane));
            }
        }
    }

    state.cars = state.cars.filter(car => car.active);

    state.cars.forEach(car => {
        car.update(state.chaos);
    });
}

function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); 

    drawGrid();
    drawRoads();
    
    handleSimulation();
    
    state.cars.forEach(car => car.draw(ctx));
    
    drawUIOverlay();

    statusCars.innerText = `Vehículos: ${state.cars.length} | Caos: ${state.chaos}%`;

    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
