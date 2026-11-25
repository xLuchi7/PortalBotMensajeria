import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

export default function NoEncontrada() {
  return (
    <div className="card">
      <div className="empty-state">
        <Icon name="search" />
        <h3>No encontramos esta página</h3>
        <p>Puede que el link esté mal o que ya no exista.</p>
        <Link to="/" className="btn btn-primary">Ir al inicio</Link>
      </div>
    </div>
  );
}
