export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  shape: 'dot' | 'shard' | 'circle';
  rotation: number;
  rotSpeed: number;
  additive?: boolean;
}

const MAX_PARTICLES = 400; // §9.6

/** Six particle systems from §9.6, all pooled behind one array capped at 400. */
export class ParticleSystem {
  particles: Particle[] = [];

  private spawn(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  boneShards(x: number, y: number, color: string, count = 13): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 80;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        gravity: 300,
        life: 900,
        maxLife: 900,
        size: 3 + Math.random() * 4,
        color,
        shape: 'shard',
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 10,
      });
    }
  }

  ash(x: number, y: number, count = 20): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 20;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 40,
        life: 2000,
        maxLife: 2000,
        size: 1 + Math.random(),
        color: '#4A4643',
        shape: 'dot',
        rotation: 0,
        rotSpeed: 0,
      });
    }
  }

  sparks(x: number, y: number, count = 8): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 100;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0,
        life: 400,
        maxLife: 400,
        size: 1,
        color: '#D9A441',
        shape: 'dot',
        rotation: 0,
        rotSpeed: 0,
        additive: true,
      });
    }
  }

  dust(x: number, y: number, count = 8): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 20;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0,
        life: 500,
        maxLife: 500,
        size: 2,
        color: 'rgba(239,230,216,0.3)',
        shape: 'dot',
        rotation: 0,
        rotSpeed: 0,
      });
    }
  }

  wormwoodSmoke(x: number, y: number, count = 12): void {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x,
        y,
        vx: (Math.random() - 0.5) * 10,
        vy: -(15 + Math.random() * 15),
        gravity: 0,
        life: 1500,
        maxLife: 1500,
        size: 4 + Math.random() * 6,
        color: 'rgba(46,107,94,0.25)',
        shape: 'circle',
        rotation: 0,
        rotSpeed: 0,
      });
    }
  }

  goldDustIn(x0: number, y0: number, x1: number, y1: number, count = 60): void {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: x0 + Math.random() * (x1 - x0),
        y: y0 + Math.random() * (y1 - y0),
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        gravity: 0,
        life: 2000,
        maxLife: 2000,
        size: 1 + Math.random(),
        color: '#D9A441',
        shape: 'dot',
        rotation: 0,
        rotSpeed: 0,
        additive: true,
      });
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.particles = this.particles.filter((p) => (p.life -= dtMs) > 0);
    for (const p of this.particles) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.rotSpeed * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.additive) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      if (p.shape === 'shard') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.6, p.size * 0.6);
        ctx.lineTo(-p.size * 0.6, p.size * 0.6);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }
  }
}
