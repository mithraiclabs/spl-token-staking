pub trait AccountMaxSize {
  /// Returns max account size or None if max size is not known and actual
  /// instance size should be used
  fn get_max_size(&self) -> Option<usize> {
      None
  }
}