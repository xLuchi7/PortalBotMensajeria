// IDs de zona horaria de Windows (los que reconoce SQL Server en AT TIME ZONE).
// Lista acotada a los países donde probablemente haya Clientes, no la lista completa.
module.exports = [
  { id: 'Argentina Standard Time', label: 'Argentina (GMT-3)' },
  { id: 'Pacific SA Standard Time', label: 'Chile (GMT-4/-3)' },
  { id: 'SA Pacific Standard Time', label: 'Colombia / Perú / Ecuador (GMT-5)' },
  { id: 'Central Standard Time (Mexico)', label: 'México (GMT-6)' },
  { id: 'Paraguay Standard Time', label: 'Paraguay (GMT-4/-3)' },
  { id: 'Montevideo Standard Time', label: 'Uruguay (GMT-3)' },
  { id: 'Venezuela Standard Time', label: 'Venezuela (GMT-4)' },
  { id: 'E. South America Standard Time', label: 'Brasil (São Paulo, GMT-3)' },
  { id: 'Eastern Standard Time', label: 'EE.UU. — Este (GMT-5/-4)' },
  { id: 'Central Standard Time', label: 'EE.UU. — Central (GMT-6/-5)' },
  { id: 'Mountain Standard Time', label: 'EE.UU. — Montaña (GMT-7/-6)' },
  { id: 'Pacific Standard Time', label: 'EE.UU. — Pacífico (GMT-8/-7)' },
  { id: 'Romance Standard Time', label: 'España (GMT+1/+2)' },
];
